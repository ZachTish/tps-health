/**
 * Archive eligibility is separate from food recognition: historical notes and
 * linked logs can still read a definition that is no longer offered for reuse.
 * Match Health's existing root Archive/_archive convention and canonical flag.
 */
export function isArchivedFoodDefinition(path: string, frontmatter?: Record<string, unknown> | null): boolean {
  return /^(?:Archive|_archive)\//i.test(path) || frontmatter?.archived === true;
}
