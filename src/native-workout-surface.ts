import type { NativeWorkoutExerciseSnapshot, NativeWorkoutSnapshot } from './native-records';

export interface NativeWorkoutSurfaceActions {
  addExercise(): void;
  addSet(exercise: NativeWorkoutExerciseSnapshot): void;
  finish(): void | Promise<void>;
}

export interface NativeWorkoutSurfaceOptions {
  active: boolean;
  elapsedLabel: string;
  instanceKey: string;
  actions: NativeWorkoutSurfaceActions;
}

const text = (tag: keyof HTMLElementTagNameMap, value: string, className = ''): HTMLElement => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
};

const button = (label: string, title: string, handler: () => void | Promise<void>, disabled = false): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'tps-health-native-workout-button';
  element.textContent = label;
  element.setAttribute('aria-label', title);
  element.setAttribute('title', title);
  element.disabled = disabled;
  element.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!element.disabled) void handler();
  });
  return element;
};

const formatNumber = (value: number): string => Number.isFinite(value)
  ? String(Math.round(value * 100) / 100)
  : '0';

const formatRest = (seconds: number | undefined): string => {
  if (seconds == null) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`;
};

export function renderNativeWorkoutSurface(
  root: HTMLElement,
  snapshot: NativeWorkoutSnapshot,
  options: NativeWorkoutSurfaceOptions,
): void {
  const signature = JSON.stringify({
    instance: options.instanceKey,
    active: options.active,
    elapsed: options.elapsedLabel,
    id: snapshot.id,
    status: snapshot.status,
    exercises: snapshot.exercises.map((exercise) => [
      exercise.id,
      exercise.sets.map((set) => [set.id, set.reps, set.weight, set.weightUnit, set.rpe, set.restSeconds, set.setType]),
    ]),
  });
  if (root.dataset.renderKey === signature) return;
  root.dataset.renderKey = signature;
  root.dataset.workoutId = snapshot.id;
  root.dataset.workoutPath = snapshot.path;
  root.className = 'tps-health-native-workout-surface';
  root.empty();

  const header = document.createElement('header');
  header.className = 'tps-health-native-workout-header';
  const identity = document.createElement('div');
  identity.className = 'tps-health-native-workout-identity';
  identity.append(
    text('h3', 'Workout', 'tps-health-native-workout-heading'),
    text(
      'p',
      `${snapshot.status === 'complete' ? 'Complete' : options.elapsedLabel} · ${snapshot.setCount} ${snapshot.setCount === 1 ? 'set' : 'sets'} · ${snapshot.exerciseCount} ${snapshot.exerciseCount === 1 ? 'exercise' : 'exercises'}`,
      'tps-health-native-workout-summary',
    ),
  );
  const actions = document.createElement('div');
  actions.className = 'tps-health-native-workout-actions';
  actions.append(
    button('+ Exercise', 'Add exercise', options.actions.addExercise, !options.active),
    button('Finish', 'Finish active workout', options.actions.finish, !options.active),
  );
  actions.lastElementChild?.classList.add('is-primary');
  header.append(identity, actions);
  root.append(header);

  if (!snapshot.exercises.length) {
    const empty = document.createElement('div');
    empty.className = 'tps-health-native-workout-empty';
    empty.append(
      text('span', options.active ? 'No exercises yet. Add one to log your first set.' : 'No exercises were logged.'),
      button('+ Exercise', 'Add first exercise', options.actions.addExercise, !options.active),
    );
    root.append(empty);
    return;
  }

  const exerciseList = document.createElement('div');
  exerciseList.className = 'tps-health-native-workout-exercises';
  for (const exercise of snapshot.exercises) {
    const group = document.createElement('section');
    group.className = 'tps-health-native-workout-exercise';
    group.dataset.exerciseId = exercise.id;
    const exerciseHeader = document.createElement('header');
    exerciseHeader.className = 'tps-health-native-workout-exercise-header';
    const exerciseIdentity = document.createElement('div');
    exerciseIdentity.className = 'tps-health-native-workout-exercise-identity';
    exerciseIdentity.append(
      text('h4', exercise.name, 'tps-health-native-workout-exercise-name'),
      text(
        'span',
        `${exercise.sets.length} ${exercise.sets.length === 1 ? 'set' : 'sets'} · ${formatNumber(exercise.totalReps)} reps · ${formatNumber(exercise.totalVolume)} volume`,
        'tps-health-native-workout-exercise-total',
      ),
    );
    exerciseHeader.append(
      exerciseIdentity,
      button('+ Set', `Log another ${exercise.name} set`, () => options.actions.addSet(exercise), !options.active),
    );
    group.append(exerciseHeader);

    if (!exercise.sets.length) {
      group.append(text('p', 'No sets logged yet.', 'tps-health-native-workout-no-sets'));
      exerciseList.append(group);
      continue;
    }
    const table = document.createElement('div');
    table.className = 'tps-health-native-workout-table';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', `${exercise.name} sets`);
    const tableHeader = document.createElement('div');
    tableHeader.className = 'tps-health-native-workout-row is-header';
    tableHeader.setAttribute('role', 'row');
    for (const label of ['Set', 'Reps', 'Weight', 'RPE', 'Rest', 'Type']) {
      const cell = text('span', label);
      cell.setAttribute('role', 'columnheader');
      tableHeader.append(cell);
    }
    table.append(tableHeader);
    for (const set of exercise.sets) {
      const row = document.createElement('div');
      row.className = 'tps-health-native-workout-row';
      row.setAttribute('role', 'row');
      const values = [
        String(set.ordinal),
        formatNumber(set.reps),
        `${formatNumber(set.weight)} ${set.weightUnit}${set.perArm ? '/arm' : ''}`,
        set.rpe == null ? '—' : formatNumber(set.rpe),
        formatRest(set.restSeconds),
        set.setType === 'normal' ? 'Normal' : set.setType.charAt(0).toUpperCase() + set.setType.slice(1),
      ];
      for (const value of values) {
        const cell = text('span', value);
        cell.setAttribute('role', 'cell');
        row.append(cell);
      }
      table.append(row);
    }
    group.append(table);
    exerciseList.append(group);
  }
  root.append(exerciseList);
}
