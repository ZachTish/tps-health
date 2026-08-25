import type {
  NativeWorkoutExerciseSnapshot,
  NativeWorkoutSetPatch,
  NativeWorkoutSetSnapshot,
  NativeWorkoutSnapshot,
} from './native-records';

export interface NativeWorkoutSetDraft {
  reps?: number;
  weight?: number;
  weightUnit: string;
  perArm: boolean;
  rpe?: number;
  restSeconds?: number;
  setType: string;
}

export interface NativeWorkoutSurfaceActions {
  addExercise(): void;
  addSet(exercise: NativeWorkoutExerciseSnapshot, draft: NativeWorkoutSetDraft): void | Promise<void>;
  updateSet(exercise: NativeWorkoutExerciseSnapshot, set: NativeWorkoutSetSnapshot, patch: NativeWorkoutSetPatch): void | Promise<void>;
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

const stopInteraction = (element: HTMLElement): void => {
  for (const eventName of ['click', 'pointerdown', 'mousedown']) {
    element.addEventListener(eventName, (event) => event.stopPropagation());
  }
};

const numberInput = (
  value: number | undefined,
  label: string,
  options: { min?: number; max?: number; step?: string; integer?: boolean } = {},
): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'tps-health-native-workout-input';
  input.value = value == null ? '' : formatNumber(value);
  input.placeholder = '—';
  input.setAttribute('aria-label', label);
  input.setAttribute('inputmode', options.integer ? 'numeric' : 'decimal');
  if (options.min != null) input.min = String(options.min);
  if (options.max != null) input.max = String(options.max);
  input.step = options.step || (options.integer ? '1' : 'any');
  stopInteraction(input);
  return input;
};

const selectInput = (value: string, label: string, choices: Array<[string, string]>): HTMLSelectElement => {
  const select = document.createElement('select');
  select.className = 'tps-health-native-workout-select';
  select.setAttribute('aria-label', label);
  for (const [optionValue, optionLabel] of choices) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }
  select.value = value;
  stopInteraction(select);
  return select;
};

const parsedNumber = (input: HTMLInputElement): number | undefined => {
  const value = input.value.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const setTypeOptions: Array<[string, string]> = [
  ['normal', 'Normal'],
  ['warmup', 'Warmup'],
  ['drop', 'Drop'],
  ['failure', 'Failure'],
];

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
    let focusDraft = (): void => undefined;
    exerciseHeader.append(
      exerciseIdentity,
      button('+ Set', `Enter another ${exercise.name} set inline`, () => focusDraft(), !options.active),
    );
    group.append(exerciseHeader);
    const table = document.createElement('div');
    table.className = 'tps-health-native-workout-table';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', `${exercise.name} sets`);
    const tableHeader = document.createElement('div');
    tableHeader.className = 'tps-health-native-workout-row is-header';
    tableHeader.setAttribute('role', 'row');
    for (const label of ['Set', 'Reps', 'Weight', 'RPE', 'Rest', 'Type', '']) {
      const cell = text('span', label);
      cell.setAttribute('role', 'columnheader');
      tableHeader.append(cell);
    }
    table.append(tableHeader);
    for (const set of exercise.sets) {
      const row = document.createElement('div');
      row.className = 'tps-health-native-workout-row';
      row.setAttribute('role', 'row');
      row.dataset.setId = set.id;
      const ordinal = text('span', String(set.ordinal), 'tps-health-native-workout-ordinal');
      ordinal.setAttribute('role', 'cell');
      row.append(ordinal);
      if (!options.active) {
        const values = [
          formatNumber(set.reps),
          `${formatNumber(set.weight)} ${set.weightUnit}${set.perArm ? '/arm' : ''}`,
          set.rpe == null ? '—' : formatNumber(set.rpe),
          formatRest(set.restSeconds),
          set.setType === 'normal' ? 'Normal' : set.setType.charAt(0).toUpperCase() + set.setType.slice(1),
          '',
        ];
        for (const value of values) {
          const cell = text('span', value);
          cell.setAttribute('role', 'cell');
          row.append(cell);
        }
        table.append(row);
        continue;
      }

      const status = text('span', '', 'tps-health-native-workout-save-state');
      status.setAttribute('role', 'status');
      const commit = async (control: HTMLInputElement | HTMLSelectElement, patch: NativeWorkoutSetPatch): Promise<void> => {
        control.disabled = true;
        status.textContent = 'Saving…';
        try {
          await options.actions.updateSet(exercise, set, patch);
          status.textContent = 'Saved';
        } catch {
          status.textContent = 'Retry';
        } finally {
          control.disabled = false;
        }
      };
      const reps = numberInput(set.reps, `${exercise.name} set ${set.ordinal} reps`, { min: 0, step: '1', integer: true });
      reps.addEventListener('change', () => void commit(reps, { reps: Math.max(0, parsedNumber(reps) || 0) }));
      row.append(reps);

      const weightCell = document.createElement('div');
      weightCell.className = 'tps-health-native-workout-weight-cell';
      weightCell.setAttribute('role', 'cell');
      const weight = numberInput(set.weight, `${exercise.name} set ${set.ordinal} weight`, { min: 0 });
      const unitChoices: Array<[string, string]> = [['lb', 'lb'], ['kg', 'kg']];
      if (!unitChoices.some(([unit]) => unit === set.weightUnit)) unitChoices.unshift([set.weightUnit, set.weightUnit]);
      const unit = selectInput(set.weightUnit, `${exercise.name} set ${set.ordinal} weight unit`, unitChoices);
      const perArm = document.createElement('label');
      perArm.className = 'tps-health-native-workout-per-arm';
      perArm.setAttribute('title', 'Weight is per arm');
      const perArmToggle = document.createElement('input');
      perArmToggle.type = 'checkbox';
      perArmToggle.checked = set.perArm;
      perArmToggle.setAttribute('aria-label', `${exercise.name} set ${set.ordinal} weight is per arm`);
      perArm.append(perArmToggle, text('span', '×2'));
      stopInteraction(perArm);
      weight.addEventListener('change', () => void commit(weight, { weight: Math.max(0, parsedNumber(weight) || 0) }));
      unit.addEventListener('change', () => void commit(unit, { weightUnit: unit.value }));
      perArmToggle.addEventListener('change', () => void commit(perArmToggle, { perArm: perArmToggle.checked }));
      weightCell.append(weight, unit, perArm);
      row.append(weightCell);

      const rpe = numberInput(set.rpe, `${exercise.name} set ${set.ordinal} RPE`, { min: 0, max: 10, step: '0.5' });
      rpe.addEventListener('change', () => void commit(rpe, { rpe: parsedNumber(rpe) ?? null }));
      row.append(rpe);
      const rest = numberInput(set.restSeconds, `${exercise.name} set ${set.ordinal} rest seconds`, { min: 0, step: '1', integer: true });
      rest.addEventListener('change', () => void commit(rest, { restSeconds: parsedNumber(rest) ?? null }));
      row.append(rest);
      const setType = selectInput(set.setType, `${exercise.name} set ${set.ordinal} type`, setTypeOptions);
      setType.addEventListener('change', () => void commit(setType, { setType: setType.value }));
      row.append(setType, status);
      table.append(row);
    }

    if (options.active) {
      const previous = exercise.sets.at(-1);
      const draft = document.createElement('div');
      draft.className = 'tps-health-native-workout-row is-draft';
      draft.setAttribute('role', 'row');
      const ordinal = text('span', String(exercise.sets.length + 1), 'tps-health-native-workout-ordinal');
      ordinal.setAttribute('role', 'cell');
      const reps = numberInput(previous?.reps, `${exercise.name} new set reps`, { min: 0, step: '1', integer: true });
      const weightCell = document.createElement('div');
      weightCell.className = 'tps-health-native-workout-weight-cell';
      weightCell.setAttribute('role', 'cell');
      const weight = numberInput(previous?.weight, `${exercise.name} new set weight`, { min: 0 });
      const previousUnit = previous?.weightUnit || 'lb';
      const unitChoices: Array<[string, string]> = [['lb', 'lb'], ['kg', 'kg']];
      if (!unitChoices.some(([unit]) => unit === previousUnit)) unitChoices.unshift([previousUnit, previousUnit]);
      const unit = selectInput(previousUnit, `${exercise.name} new set weight unit`, unitChoices);
      const perArm = document.createElement('label');
      perArm.className = 'tps-health-native-workout-per-arm';
      perArm.setAttribute('title', 'Weight is per arm');
      const perArmToggle = document.createElement('input');
      perArmToggle.type = 'checkbox';
      perArmToggle.checked = previous?.perArm === true;
      perArmToggle.setAttribute('aria-label', `${exercise.name} new set weight is per arm`);
      perArm.append(perArmToggle, text('span', '×2'));
      stopInteraction(perArm);
      weightCell.append(weight, unit, perArm);
      const rpe = numberInput(previous?.rpe, `${exercise.name} new set RPE`, { min: 0, max: 10, step: '0.5' });
      const rest = numberInput(undefined, `${exercise.name} new set rest seconds`, { min: 0, step: '1', integer: true });
      const setType = selectInput(previous?.setType || 'normal', `${exercise.name} new set type`, setTypeOptions);
      const log = button('Log', `Log ${exercise.name} set`, async () => {
        log.disabled = true;
        log.textContent = 'Saving…';
        try {
          await options.actions.addSet(exercise, {
            reps: parsedNumber(reps),
            weight: parsedNumber(weight),
            weightUnit: unit.value,
            perArm: perArmToggle.checked,
            rpe: parsedNumber(rpe),
            restSeconds: parsedNumber(rest),
            setType: setType.value,
          });
        } catch {
          log.disabled = false;
          log.textContent = 'Retry';
        }
      });
      log.classList.add('is-compact', 'is-primary');
      draft.append(ordinal, reps, weightCell, rpe, rest, setType, log);
      table.append(draft);
      focusDraft = () => {
        draft.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        window.setTimeout(() => {
          reps.focus();
          reps.select();
        }, 0);
      };
    }
    group.append(table);
    exerciseList.append(group);
  }
  root.append(exerciseList);
}
