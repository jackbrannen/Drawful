-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE drawful_prompts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text text NOT NULL,
  used_at timestamptz
);

CREATE TABLE drawful_games (
  code text PRIMARY KEY,
  phase text NOT NULL DEFAULT 'lobby',
  host_id uuid,
  is_dummy boolean NOT NULL DEFAULT false,
  current_drawing_index integer NOT NULL DEFAULT 0,
  drawing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drawful_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text REFERENCES drawful_games(code),
  name text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  seat integer,
  is_bot boolean NOT NULL DEFAULT false,
  score integer NOT NULL DEFAULT 0,
  prompt text,
  drawing_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fake answers + the real answer (added when voting starts)
CREATE TABLE drawful_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text REFERENCES drawful_games(code),
  drawing_player_id uuid REFERENCES drawful_players(id),
  author_id uuid REFERENCES drawful_players(id), -- null for the real answer
  text text NOT NULL,
  is_real boolean NOT NULL DEFAULT false,
  display_order integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One vote per player per drawing
CREATE TABLE drawful_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text REFERENCES drawful_games(code),
  drawing_player_id uuid REFERENCES drawful_players(id),
  voter_id uuid REFERENCES drawful_players(id),
  answer_id uuid REFERENCES drawful_answers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_code, drawing_player_id, voter_id)
);

-- Enable realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE drawful_games;
ALTER PUBLICATION supabase_realtime ADD TABLE drawful_players;
ALTER PUBLICATION supabase_realtime ADD TABLE drawful_answers;
ALTER PUBLICATION supabase_realtime ADD TABLE drawful_votes;

-- ─── RPC: drawful_start_game ──────────────────────────────────────────────────
-- Assigns prompts, seats players, kicks off the drawing timer.

CREATE OR REPLACE FUNCTION drawful_start_game(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_player_ids uuid[];
  v_n integer;
  v_prompt_texts text[];
BEGIN
  -- Collect player IDs ordered by join time and assign seats
  SELECT array_agg(id ORDER BY created_at) INTO v_player_ids
  FROM drawful_players WHERE game_code = p_code;

  v_n := array_length(v_player_ids, 1);

  FOR i IN 1..v_n LOOP
    UPDATE drawful_players SET seat = i - 1 WHERE id = v_player_ids[i];
  END LOOP;

  -- Pull unused prompts (one per player)
  SELECT array_agg(text ORDER BY random()) INTO v_prompt_texts
  FROM (
    SELECT text, id FROM drawful_prompts WHERE used_at IS NULL ORDER BY random() LIMIT v_n
  ) sub;

  -- Mark them used and assign to players
  FOR i IN 1..v_n LOOP
    UPDATE drawful_players SET prompt = v_prompt_texts[i] WHERE id = v_player_ids[i];
  END LOOP;

  UPDATE drawful_prompts
  SET used_at = now()
  WHERE text = ANY(v_prompt_texts) AND used_at IS NULL;

  -- Start game
  UPDATE drawful_games
  SET phase = 'drawing',
      drawing_started_at = now(),
      current_drawing_index = 0
  WHERE code = p_code;
END;
$$;

-- ─── RPC: drawful_submit_drawing ──────────────────────────────────────────────
-- Saves a player's drawing URL. Advances to guessing when all are in.

CREATE OR REPLACE FUNCTION drawful_submit_drawing(
  p_code text,
  p_player_id uuid,
  p_drawing_url text
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total integer;
  v_submitted integer;
BEGIN
  UPDATE drawful_players SET drawing_url = p_drawing_url WHERE id = p_player_id AND game_code = p_code;

  SELECT count(*) INTO v_total FROM drawful_players WHERE game_code = p_code;
  SELECT count(*) INTO v_submitted FROM drawful_players WHERE game_code = p_code AND drawing_url IS NOT NULL;

  IF v_submitted >= v_total THEN
    UPDATE drawful_games SET phase = 'guessing', current_drawing_index = 0 WHERE code = p_code;
  END IF;
END;
$$;

-- ─── RPC: drawful_submit_answer ───────────────────────────────────────────────
-- Saves a fake answer. When all non-artists have submitted, shuffles answers,
-- inserts the real answer, and advances to voting.

CREATE OR REPLACE FUNCTION drawful_submit_answer(
  p_code text,
  p_drawing_player_id uuid,
  p_author_id uuid,
  p_text text
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total_non_artist integer;
  v_submitted integer;
  v_real_prompt text;
  v_answer_ids uuid[];
  v_n integer;
BEGIN
  -- Upsert: one answer per author per drawing
  INSERT INTO drawful_answers(game_code, drawing_player_id, author_id, text, is_real)
  VALUES (p_code, p_drawing_player_id, p_author_id, p_text, false)
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_total_non_artist
  FROM drawful_players WHERE game_code = p_code AND id <> p_drawing_player_id;

  SELECT count(*) INTO v_submitted
  FROM drawful_answers
  WHERE game_code = p_code AND drawing_player_id = p_drawing_player_id AND is_real = false;

  IF v_submitted >= v_total_non_artist THEN
    -- Add the real answer
    SELECT prompt INTO v_real_prompt FROM drawful_players WHERE id = p_drawing_player_id;
    INSERT INTO drawful_answers(game_code, drawing_player_id, author_id, text, is_real)
    VALUES (p_code, p_drawing_player_id, null, v_real_prompt, true);

    -- Assign randomised display_order to all answers for this drawing
    SELECT array_agg(id ORDER BY random()) INTO v_answer_ids
    FROM drawful_answers WHERE game_code = p_code AND drawing_player_id = p_drawing_player_id;

    v_n := array_length(v_answer_ids, 1);
    FOR i IN 1..v_n LOOP
      UPDATE drawful_answers SET display_order = i WHERE id = v_answer_ids[i];
    END LOOP;

    UPDATE drawful_games SET phase = 'voting' WHERE code = p_code;
  END IF;
END;
$$;

-- ─── RPC: drawful_submit_vote ─────────────────────────────────────────────────
-- Saves a vote. When all non-artists have voted, calculates scores and
-- advances to results.

CREATE OR REPLACE FUNCTION drawful_submit_vote(
  p_code text,
  p_drawing_player_id uuid,
  p_voter_id uuid,
  p_answer_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total_non_artist integer;
  v_voted integer;
  v_answer record;
BEGIN
  INSERT INTO drawful_votes(game_code, drawing_player_id, voter_id, answer_id)
  VALUES (p_code, p_drawing_player_id, p_voter_id, p_answer_id)
  ON CONFLICT (game_code, drawing_player_id, voter_id) DO NOTHING;

  SELECT count(*) INTO v_total_non_artist
  FROM drawful_players WHERE game_code = p_code AND id <> p_drawing_player_id;

  SELECT count(*) INTO v_voted
  FROM drawful_votes WHERE game_code = p_code AND drawing_player_id = p_drawing_player_id;

  IF v_voted >= v_total_non_artist THEN
    -- Award 1000 pts per correct guess
    UPDATE drawful_players p
    SET score = score + 1000
    FROM drawful_votes v
    JOIN drawful_answers a ON a.id = v.answer_id
    WHERE v.game_code = p_code
      AND v.drawing_player_id = p_drawing_player_id
      AND a.is_real = true
      AND p.id = v.voter_id;

    -- Award 500 pts per vote received on each fake answer
    UPDATE drawful_players p
    SET score = score + (
      SELECT count(*) * 500
      FROM drawful_votes v
      JOIN drawful_answers a ON a.id = v.answer_id
      WHERE v.game_code = p_code
        AND v.drawing_player_id = p_drawing_player_id
        AND a.author_id = p.id
        AND a.is_real = false
    )
    WHERE game_code = p_code AND id <> p_drawing_player_id;

    UPDATE drawful_games SET phase = 'results' WHERE code = p_code;
  END IF;
END;
$$;

-- ─── RPC: drawful_next_drawing ────────────────────────────────────────────────
-- Host advances from results to next guessing round or finished.

CREATE OR REPLACE FUNCTION drawful_next_drawing(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total integer;
  v_next integer;
BEGIN
  SELECT count(*) INTO v_total FROM drawful_players WHERE game_code = p_code;
  SELECT current_drawing_index + 1 INTO v_next FROM drawful_games WHERE code = p_code;

  IF v_next >= v_total THEN
    UPDATE drawful_games SET phase = 'finished' WHERE code = p_code;
  ELSE
    UPDATE drawful_games SET phase = 'guessing', current_drawing_index = v_next WHERE code = p_code;
  END IF;
END;
$$;

-- ─── RPC: drawful_reset_game ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION drawful_reset_game(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM drawful_votes WHERE game_code = p_code;
  DELETE FROM drawful_answers WHERE game_code = p_code;
  UPDATE drawful_players SET score = 0, prompt = null, drawing_url = null, seat = null WHERE game_code = p_code;
  UPDATE drawful_games
  SET phase = 'lobby', current_drawing_index = 0, drawing_started_at = null
  WHERE code = p_code;
END;
$$;
