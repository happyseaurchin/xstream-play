-- Add paid column to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS paid boolean DEFAULT false;

-- Set david as paid
UPDATE public.users SET paid = true WHERE id = 'c1447c8c-9c82-4725-b06f-81df6b017958';

-- Create saved_games table for cloud saves
CREATE TABLE IF NOT EXISTS public.saved_games (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  game_id text NOT NULL,
  char_id text NOT NULL,
  save_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, game_id, char_id)
);

-- Enable RLS
ALTER TABLE public.saved_games ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own saves
CREATE POLICY "Users read own saves" ON public.saved_games
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own saves" ON public.saved_games
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own saves" ON public.saved_games
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users delete own saves" ON public.saved_games
  FOR DELETE USING (auth.uid() = user_id);
