/**
 * Workspace assay type: single-select. Free = all tasks/tabs; others limit to that assay.
 */

export const WORKSPACE_ASSAY_TYPES = ["free", "expression", "kill", "tissue"] as const;
export type WorkspaceAssayType = (typeof WORKSPACE_ASSAY_TYPES)[number];

export const ASSAY_TYPE_DISPLAY: Record<WorkspaceAssayType, string> = {
  free: "Free",
  expression: "Expression",
  kill: "Kill",
  tissue: "Tissue",
};

/** Assay-only types (excludes free). Used for stored workspaceTags. */
export const ASSAY_TAGS = ["expression", "kill", "tissue"] as const;
export type AssayTag = (typeof ASSAY_TAGS)[number];

export const ASSAY_TAG_DISPLAY: Record<AssayTag, string> = {
  expression: "Expression",
  kill: "Kill",
  tissue: "Tissue",
};

export const INFRASTRUCTURE_TASK_KINDS = [
  "file.convert",
  "file.crop",
  "file.movie",
] as const;

const ASSAY_TASK_KINDS: Record<AssayTag, string> = {
  expression: "expression.analyze",
  kill: "kill.predict",
  tissue: "tissue.analyze",
};

const TAG_TO_APP_TAB: Record<AssayTag, ApplicationTab> = {
  expression: "expression",
  kill: "kill",
  tissue: "tissue",
};

export type ApplicationTab = "expression" | "kill" | "tissue";

const ALL_APP_TABS: ApplicationTab[] = ["expression", "kill", "tissue"];

/**
 * Resolves workspace tags to a single assay type. Free = empty or "free"; else first valid assay.
 */
export function getWorkspaceAssayType(workspaceTags: string[]): WorkspaceAssayType {
  if (workspaceTags.length === 0) return "free";
  const first = workspaceTags[0];
  if (first === "free") return "free";
  if (ASSAY_TAGS.includes(first as AssayTag)) return first as AssayTag;
  return "free";
}

/**
 * Returns task kinds visible for the given workspace tags.
 * Free = all. Assay type = infrastructure + that assay only.
 */
export function getVisibleTaskKinds(workspaceTags: string[]): string[] {
  const base = [...INFRASTRUCTURE_TASK_KINDS];
  const type = getWorkspaceAssayType(workspaceTags);
  if (type === "free") return [...base, ...Object.values(ASSAY_TASK_KINDS)];
  return [...base, ASSAY_TASK_KINDS[type]];
}

/**
 * Returns application tabs visible for the given workspace tags.
 * Free = all tabs. Assay type = that tab only.
 */
export function getVisibleTabs(workspaceTags: string[]): ApplicationTab[] {
  const type = getWorkspaceAssayType(workspaceTags);
  if (type === "free") return [...ALL_APP_TABS];
  return [TAG_TO_APP_TAB[type]];
}
