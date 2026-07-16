export const TPS_HEALTH_LOG_FOOD_HOME_ACTION = 'tps-health:log-food';
export const TPS_HEALTH_LOG_ACTIVITY_HOME_ACTION = 'tps-health:log-activity';
export const TPS_HEALTH_START_WORKOUT_HOME_ACTION = 'tps-health:start-workout';

export interface TPSHealthHomeActionContext {
  source: 'tps-home';
  dateIso: string;
  dailyNotePath: string;
  componentId: string;
  basePath?: string;
}

export interface TPSHealthHomeDateContext {
  dateIso: string;
  label: string;
  isToday: boolean;
  dailyNotePath: string;
  foodLogTarget: 'daily-note';
  focusAfterLog: false;
}

export interface TPSHealthHomeActionProvider {
  version: 1;
  canHandle(commandId: string): boolean;
  execute(commandId: string, context: TPSHealthHomeActionContext): boolean;
}

export interface TPSHealthHomeActionHost {
  openFoodLogger(dateContext: TPSHealthHomeDateContext): void;
  openActivityLogger(dateContext: TPSHealthHomeDateContext): void;
  openWorkoutStarter(dateContext: TPSHealthHomeDateContext): void;
}

export function createTPSHealthHomeActionProvider(host: TPSHealthHomeActionHost): TPSHealthHomeActionProvider {
  return {
    version: 1,
    canHandle(commandId: string): boolean {
      return commandId === TPS_HEALTH_LOG_FOOD_HOME_ACTION
        || commandId === TPS_HEALTH_LOG_ACTIVITY_HOME_ACTION
        || commandId === TPS_HEALTH_START_WORKOUT_HOME_ACTION;
    },
    execute(commandId: string, context: TPSHealthHomeActionContext): boolean {
      if (!isValidHomeContext(context)) return false;
      const dateContext = toTPSHealthHomeDateContext(context);
      if (commandId === TPS_HEALTH_LOG_FOOD_HOME_ACTION) {
        host.openFoodLogger(dateContext);
        return true;
      }
      if (commandId === TPS_HEALTH_LOG_ACTIVITY_HOME_ACTION) {
        host.openActivityLogger(dateContext);
        return true;
      }
      if (commandId === TPS_HEALTH_START_WORKOUT_HOME_ACTION) {
        host.openWorkoutStarter(dateContext);
        return true;
      }
      return false;
    },
  };
}

export function toTPSHealthHomeDateContext(context: TPSHealthHomeActionContext): TPSHealthHomeDateContext {
  const [year, month, day] = context.dateIso.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0, 0);
  const label = Number.isFinite(localDate.getTime())
    ? localDate.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    : context.dateIso;
  return {
    dateIso: context.dateIso,
    label,
    isToday: context.dateIso === localIsoDate(new Date()),
    dailyNotePath: context.dailyNotePath,
    foodLogTarget: 'daily-note',
    focusAfterLog: false,
  };
}

function isValidHomeContext(context: TPSHealthHomeActionContext): boolean {
  return context?.source === 'tps-home'
    && isValidIsoDate(String(context.dateIso || ''))
    && Boolean(String(context.dailyNotePath || '').trim());
}

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function localIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
