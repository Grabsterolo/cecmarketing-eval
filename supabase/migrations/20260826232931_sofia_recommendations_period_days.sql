-- El reporte pasa de cubrir "ayer" a cubrir una ventana de 5 días.
-- period_days deja registrado cuántos días cubre cada fila, para que las
-- filas históricas (diarias) no se confundan con las nuevas.
-- Aditivo: default 1 = las filas existentes quedan marcadas como diarias, y
-- el índice único sobre date se mantiene (date sigue siendo el último día de
-- la ventana, así que no hay colisión).
ALTER TABLE public.sofia_recommendations
  ADD COLUMN IF NOT EXISTS period_days integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.sofia_recommendations.period_days IS
  'Cuántos días cubre el análisis. 1 = reporte diario (histórico, hasta 2026-08-23). 5 = corte de rendimiento. date siempre es el último día de la ventana.';
