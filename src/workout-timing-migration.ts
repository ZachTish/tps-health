import type { TPSHealthSettings } from './types';
import { workoutStartPropertyKey, workoutIntervalPropertyKey, workoutIntervalMode, WORKOUT_TEMPORAL_COMPATIBILITY_KEYS } from './workout-properties';

/** Historical timing names are migration input only, never normal readers. */
export function migrateWorkoutTiming(source: Record<string, unknown>, before: TPSHealthSettings, after: TPSHealthSettings): Record<string, unknown> {
  const next = { ...source };
  const oldStart = workoutStartPropertyKey(before), oldInterval = workoutIntervalPropertyKey(before);
  const newStart = workoutStartPropertyKey(after), newInterval = workoutIntervalPropertyKey(after);
  const pick = (keys: string[], numeric = false): unknown => {
    const values = [...new Set(keys)].filter(key => source[key] != null && source[key] !== '').map(key => {
      if (!numeric) return String(source[key]);
      const value = Number(source[key]) / (key === 'durationSeconds' ? 60 : 1);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid workout duration in “${key}”.`);
      return value;
    });
    if (new Set(values.map(value => JSON.stringify(value))).size > 1) throw new Error('Conflicting workout timing properties.');
    return values[0];
  };
  const start = pick([oldStart, ...['scheduled', 'startedAt'].filter(key => key !== oldInterval)]);
  let duration = pick([...(workoutIntervalMode(before) === 'duration' ? [oldInterval] : []), ...['timeEstimate', 'durationMinutes', 'durationSeconds'].filter(key => key !== oldStart && (workoutIntervalMode(before) === 'duration' || key !== oldInterval))], true) as number | undefined;
  let end = pick([...(workoutIntervalMode(before) === 'end' ? [oldInterval] : []), ...['end', 'endedAt', 'completedDate'].filter(key => key !== oldStart && (workoutIntervalMode(before) === 'end' || key !== oldInterval))]) as string | undefined;
  const startTime = start === undefined ? NaN : Date.parse(String(start));
  if (end !== undefined && duration !== undefined && Number.isFinite(startTime) && Math.abs(Date.parse(end) - startTime - duration * 60000) > 1) throw new Error('Workout end and duration disagree.');
  if (workoutIntervalMode(after) === 'end' && end === undefined && duration !== undefined) {
    if (!Number.isFinite(startTime)) throw new Error('A valid workout start is required to convert duration to an end time.');
    end = new Date(startTime + duration * 60000).toISOString();
  }
  if (workoutIntervalMode(after) === 'duration' && duration === undefined && end !== undefined) {
    const endTime = Date.parse(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) throw new Error('Valid workout start and end times are required to convert to duration.');
    duration = (endTime - startTime) / 60000;
  }
  const sources = new Set<string>([oldStart, oldInterval, ...WORKOUT_TEMPORAL_COMPATIBILITY_KEYS]);
  const put = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (!sources.has(key) && Object.prototype.hasOwnProperty.call(source, key) && JSON.stringify(source[key]) !== JSON.stringify(value)) throw new Error(`Property “${key}” already contains a different value.`);
    next[key] = value;
  };
  for (const key of sources) delete next[key];
  put(newStart, start);
  put(newInterval, workoutIntervalMode(after) === 'duration' ? duration : end);
  return next;
}
