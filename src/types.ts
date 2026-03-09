export type PaneTarget = `${string}:${number}.${number}`;

export interface TmuxPane {
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
  currentPath: string;
  isActive: boolean;
  tty: string;
  target: PaneTarget;
}

export type DetectionConfidence = "high" | "medium" | "low";

export interface PaneDetection {
  isOpencode: boolean;
  confidence: DetectionConfidence;
  reasons: string[];
}

export interface DiscoveredPane {
  pane: TmuxPane;
  detection: PaneDetection;
}

export type RuntimeStatus = "running" | "waiting-question" | "waiting-input" | "idle" | "unknown";

export interface SessionMatch {
  id: string;
  directory: string;
  title: string;
  timeUpdated: number;
}

export interface RuntimeInfo {
  status: RuntimeStatus;
  source: "sqlite-exact" | "sqlite-descendant-running" | "sqlite-descendant-recent" | "sqlite-descendant-only" | "unmapped";
  session: SessionMatch | null;
  detail: string;
}

export interface PaneRuntimeSummary extends DiscoveredPane {
  runtime: RuntimeInfo;
}

export interface InspectResult {
  target: PaneTarget;
  summary: PaneRuntimeSummary;
}
