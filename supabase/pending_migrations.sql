-- ─── RPC: drawful_start_game ──────────────────────────────────────────────────
-- Assigns prompts, seats players, kicks off the drawing timer.
-- If a prompt contains [Player], replaces it with a random other player's first name.

CREATE OR REPLACE FUNCTION drawful_start_game(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_player_ids uuid[];
  v_n integer;
  v_prompt_texts text[];
  v_prompt text;
  v_other_name text;
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

  -- Mark them used
  UPDATE drawful_prompts
  SET used_at = now()
  WHERE text = ANY(v_prompt_texts) AND used_at IS NULL;

  -- Assign prompts, replacing [Player] with a random other player's first name
  FOR i IN 1..v_n LOOP
    v_prompt := v_prompt_texts[i];

    IF v_prompt LIKE '%[Player]%' THEN
      SELECT first_name INTO v_other_name
      FROM drawful_players
      WHERE game_code = p_code AND id <> v_player_ids[i]
      ORDER BY random() LIMIT 1;

      v_prompt := REPLACE(v_prompt, '[Player]', v_other_name);
    END IF;

    UPDATE drawful_players SET prompt = v_prompt WHERE id = v_player_ids[i];
  END LOOP;

  -- Start game
  UPDATE drawful_games
  SET phase = 'drawing',
      drawing_started_at = now(),
      current_drawing_index = 0
  WHERE code = p_code;
END;
$$;
