-- Add ready_player_ids column to track who has pressed Ready on the results screen
ALTER TABLE drawful_games
  ADD COLUMN IF NOT EXISTS ready_player_ids uuid[] DEFAULT '{}';

-- Updated drawful_submit_vote:
--   - Rejects if the chosen answer_id already has a vote from a different player
--   - Awards 1 pt to voter for correct guess, 1 pt to fake-answer author per fool
--   - Advances phase to 'results' when all eligible voters have voted
CREATE OR REPLACE FUNCTION drawful_submit_vote(
  p_code              text,
  p_drawing_player_id uuid,
  p_voter_id          uuid,
  p_answer_id         uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total_non_artist int;
  v_voted            int;
BEGIN
  -- Skip if voter already voted for this drawing
  IF EXISTS (
    SELECT 1 FROM drawful_votes
    WHERE game_code = p_code
      AND drawing_player_id = p_drawing_player_id
      AND voter_id = p_voter_id
  ) THEN RETURN; END IF;

  -- Reject if another player already claimed this answer
  IF EXISTS (
    SELECT 1 FROM drawful_votes
    WHERE game_code = p_code
      AND drawing_player_id = p_drawing_player_id
      AND answer_id = p_answer_id
      AND voter_id != p_voter_id
  ) THEN
    RAISE EXCEPTION 'answer_already_taken';
  END IF;

  INSERT INTO drawful_votes (game_code, drawing_player_id, voter_id, answer_id)
  VALUES (p_code, p_drawing_player_id, p_voter_id, p_answer_id);

  SELECT count(*) INTO v_total_non_artist
  FROM drawful_players WHERE game_code = p_code AND id != p_drawing_player_id;

  SELECT count(*) INTO v_voted
  FROM drawful_votes WHERE game_code = p_code AND drawing_player_id = p_drawing_player_id;

  IF v_voted >= v_total_non_artist THEN
    -- 1 pt per correct guess
    UPDATE drawful_players p
    SET score = score + 1
    FROM drawful_votes v
    JOIN drawful_answers a ON a.id = v.answer_id
    WHERE v.game_code = p_code
      AND v.drawing_player_id = p_drawing_player_id
      AND a.is_real = true
      AND p.id = v.voter_id;

    -- 1 pt per vote received on each fake answer
    UPDATE drawful_players p
    SET score = score + (
      SELECT count(*)
      FROM drawful_votes v
      JOIN drawful_answers a ON a.id = v.answer_id
      WHERE v.game_code = p_code
        AND v.drawing_player_id = p_drawing_player_id
        AND a.author_id = p.id
        AND a.is_real = false
    )
    WHERE game_code = p_code AND id != p_drawing_player_id;

    UPDATE drawful_games SET phase = 'results', ready_player_ids = '{}'
    WHERE code = p_code;
  END IF;
END;
$$;

-- drawful_mark_ready: called by each player on the results screen.
-- Once 50%+ of players are ready, advances to the next drawing (or finished).
CREATE OR REPLACE FUNCTION drawful_mark_ready(
  p_code      text,
  p_player_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ready_count int;
  v_total_count int;
BEGIN
  UPDATE drawful_games
  SET ready_player_ids = array_append(COALESCE(ready_player_ids, '{}'), p_player_id)
  WHERE code = p_code
    AND NOT (p_player_id = ANY(COALESCE(ready_player_ids, '{}')));

  SELECT
    COALESCE(array_length(ready_player_ids, 1), 0),
    (SELECT count(*) FROM drawful_players WHERE game_code = p_code)
  INTO v_ready_count, v_total_count
  FROM drawful_games WHERE code = p_code;

  IF v_ready_count * 2 >= v_total_count THEN
    PERFORM drawful_next_drawing(p_code);
    UPDATE drawful_games SET ready_player_ids = '{}' WHERE code = p_code;
  END IF;
END;
$$;

-- drawful_next_drawing: advance to next drawing's guessing phase, or finish the game
CREATE OR REPLACE FUNCTION drawful_next_drawing(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_next_index   int;
  v_player_count int;
BEGIN
  SELECT current_drawing_index + 1,
         (SELECT count(*) FROM drawful_players WHERE game_code = p_code)
  INTO v_next_index, v_player_count
  FROM drawful_games WHERE code = p_code;

  IF v_next_index >= v_player_count THEN
    UPDATE drawful_games SET phase = 'finished' WHERE code = p_code;
  ELSE
    UPDATE drawful_games
    SET current_drawing_index = v_next_index, phase = 'guessing'
    WHERE code = p_code;
  END IF;
END;
$$;

-- drawful_reset_game: return to lobby and clear all round data
CREATE OR REPLACE FUNCTION drawful_reset_game(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE drawful_games
  SET phase = 'lobby', current_drawing_index = 0, ready_player_ids = '{}'
  WHERE code = p_code;

  DELETE FROM drawful_answers WHERE game_code = p_code;
  DELETE FROM drawful_votes   WHERE game_code = p_code;

  UPDATE drawful_players
  SET score = 0, drawing_url = NULL, prompt = NULL, seat = NULL
  WHERE game_code = p_code;
END;
$$;
