export const WORKSPACE_ASSAY_TYPES = ["kill"] as const;
export type WorkspaceAssayType = (typeof WORKSPACE_ASSAY_TYPES)[number];

export const ASSAY_TYPE_DISPLAY: Record<WorkspaceAssayType, string> = {
  kill: "Kill",
};

/** Only kill remains as a supported assay tag. */
export const ASSAY_TAGS = ["kill"] as const;
export type AssayTag = (typeof ASSAY_TAGS)[number];

export const ASSAY_TAG_DISPLAY: Record<AssayTag, string> = {
  kill: "Kill",
};

export const INFRASTRUCTURE_TASK_KINDS = [
  "file.convert",
  "file.crop",
  "file.movie",
] as const;

const ASSAY_TASK_KINDS: Record<AssayTag, string> = {
  kill: "kill.predict",
};

const TAG_TO_APP_TAB: Record<AssayTag, ApplicationTab> = {
  kill: "kill",
};

export type ApplicationTab = "kill";

export function getWorkspaceAssayType(workspaceTags: string[]): WorkspaceAssayType {
  const first = workspaceTags[0];
  if (ASSAY_TAGS.includes(first as AssayTag)) return first as AssayTag;
  return "kill";
}

export function getVisibleTaskKinds(workspaceTags: string[]): string[] {
  const base = [...INFRASTRUCTURE_TASK_KINDS];
  const type = getWorkspaceAssayType(workspaceTags);
  return [...base, ASSAY_TASK_KINDS[type]];
}

export function getVisibleTabs(workspaceTags: string[]): ApplicationTab[] {
  const type = getWorkspaceAssayType(workspaceTags);
  return [TAG_TO_APP_TAB[type]];
}
