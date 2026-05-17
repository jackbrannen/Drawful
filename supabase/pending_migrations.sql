-- ─── RPC: drawful_submit_vote ─────────────────────────────────────────────────
-- Saves a vote. When all non-artists have voted, calculates scores and
-- advances to results. Scoring: 1 pt for correct guess, 1 pt per person fooled.

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
BEGIN
  INSERT INTO drawful_votes(game_code, drawing_player_id, voter_id, answer_id)
  VALUES (p_code, p_drawing_player_id, p_voter_id, p_answer_id)
  ON CONFLICT (game_code, drawing_player_id, voter_id) DO NOTHING;

  SELECT count(*) INTO v_total_non_artist
  FROM drawful_players WHERE game_code = p_code AND id <> p_drawing_player_id;

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
    WHERE game_code = p_code AND id <> p_drawing_player_id;

    UPDATE drawful_games SET phase = 'results' WHERE code = p_code;
  END IF;
END;
$$;
