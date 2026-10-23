export const ROUTES = {
  "daily": "Daily logging",
  "food-goals": "Food & goals",
  "workouts": "Workouts",
  "library": "Note library",
  "integrations": "Integrations & advanced"
};
export const SOURCES = {
  "src/settings.ts": {
    "methods": {
      "renderDailyLoggingPage": "daily",
      "renderEarlierLogsSettings": "integrations",
      "renderFoodGoalsPage": "food-goals",
      "renderWorkoutsPage": "workouts",
      "renderNoteLibraryPage": "library",
      "addLibraryFolderSetting": "library",
      "renderIntegrationsPage": "integrations",
      "renderNativeKindSettings": "integrations",
      "renderNativeFrontmatterSettings": "integrations",
      "addNativePropertyKeySetting": "integrations",
      "addMappingSetting": "integrations"
    },
    "helpers": {
      "addLibraryFolderSetting": {
        "name": 2,
        "desc": 3
      },
      "addMappingSetting": {
        "name": 1,
        "desc": 2
      },
      "createSettingsGroup": {
        "name": 1,
        "desc": 2
      },
      "createOptionalDisclosure": {
        "name": 2,
        "desc": 3
      }
    },
    "tuples": {
      "propertyGroups": "integrations"
    }
  },
  "src/energy-settings.ts": {
    "route": "food-goals"
  },
  "src/nutrient-goal-settings.ts": {
    "route": "food-goals"
  },
  "src/custom-nutrient-settings.ts": {
    "route": "food-goals"
  },
  "src/connection-settings.ts": {
    "route": "integrations"
  }
};
export const EXTRA_ENTRIES = [];
