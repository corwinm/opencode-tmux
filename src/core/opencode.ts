import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { DiscoveredPane, PaneRuntimeSummary, RuntimeInfo, RuntimeSource, RuntimeStatus, SessionMatch } from "../types";

const RECENT_SESSION_WINDOW_MS = 30 * 60 * 1000;

interface SessionRow {
  id: string;
  directory: string;
  title: string;
  time_updated: number;
}

interface RunningPartRow {
  tool: string | null;
  status: string | null;
  option_count: number | null;
}

function getOpencodeDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

function openDatabase(): Database {
  const databasePath = getOpencodeDbPath();

  if (!existsSync(databasePath)) {
    throw new Error(`opencode database not found at ${databasePath}`);
  }

  return new Database(databasePath, { readonly: true });
}

function getSessionMatch(database: Database, directory: string): SessionMatch | null {
  const row = database
    .query(
      `
        SELECT id, directory, title, time_updated
        FROM session
        WHERE directory = ?1
        ORDER BY time_updated DESC
        LIMIT 1
      `,
    )
    .get(directory) as SessionRow | null;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    directory: row.directory,
    title: row.title,
    timeUpdated: row.time_updated,
  };
}

function toSessionMatch(row: SessionRow): SessionMatch {
  return {
    id: row.id,
    directory: row.directory,
    title: row.title,
    timeUpdated: row.time_updated,
  };
}

function getDescendantSessions(database: Database, directory: string): SessionMatch[] {
  const normalizedDirectory = directory.endsWith("/") ? directory : `${directory}/`;

  const rows = database
    .query(
      `
        SELECT id, directory, title, time_updated
        FROM session
        WHERE directory LIKE ?1
        ORDER BY time_updated DESC
      `,
    )
    .all(`${normalizedDirectory}%`) as SessionRow[];

  return rows.map(toSessionMatch);
}

function getRunningPart(database: Database, sessionId: string): RunningPartRow | null {
  return database
    .query(
      `
        SELECT
          json_extract(data, '$.tool') AS tool,
          json_extract(data, '$.state.status') AS status,
          COALESCE(json_array_length(json_extract(data, '$.state.input.questions[0].options')), 0) AS option_count
        FROM part
        WHERE session_id = ?1
          AND json_extract(data, '$.state.status') = 'running'
        ORDER BY time_updated DESC
        LIMIT 1
      `,
    )
    .get(sessionId) as RunningPartRow | null;
}

function classifyRuntime(session: SessionMatch | null, runningPart: RunningPartRow | null): RuntimeInfo {
  if (!session) {
    return {
      activity: "unknown",
      status: "unknown",
      source: "unmapped",
      match: {
        strategy: "unmapped",
        provider: "none",
        heuristic: false,
      },
      session: null,
      detail: "no matching opencode session for pane cwd",
    };
  }

  if (!runningPart || runningPart.status !== "running") {
    return {
      activity: "idle",
      status: "idle",
      source: "sqlite-exact",
      match: {
        strategy: "exact",
        provider: "sqlite",
        heuristic: false,
      },
      session,
      detail: "no running tool parts for matched session",
    };
  }

  const tool = runningPart.tool ?? "unknown";
  const optionCount = runningPart.option_count ?? 0;

  if (tool === "question") {
    const status: RuntimeStatus = optionCount > 0 ? "waiting-question" : "waiting-input";
    const detail = optionCount > 0 ? "running question tool with options" : "running question tool without options";

    return {
      activity: "busy",
      status,
      source: "sqlite-exact",
      match: {
        strategy: "exact",
        provider: "sqlite",
        heuristic: false,
      },
      session,
      detail,
    };
  }

  return {
    activity: "busy",
    status: "running",
    source: "sqlite-exact",
    match: {
      strategy: "exact",
      provider: "sqlite",
      heuristic: false,
    },
    session,
    detail: `running ${tool} tool`,
  };
}

function classifyRuntimeWithSource(
  session: SessionMatch,
  runningPart: RunningPartRow | null,
  source: RuntimeSource,
  strategy: RuntimeInfo["match"]["strategy"],
  detailPrefix: string,
): RuntimeInfo {
  const runtime = classifyRuntime(session, runningPart);

  return {
    ...runtime,
    source,
    match: {
      strategy,
      provider: "sqlite",
      heuristic: true,
    },
    detail: `${detailPrefix}; ${runtime.detail}`,
  };
}

function getHeuristicSessionMatch(
  database: Database,
  directory: string,
): { session: SessionMatch; source: RuntimeSource; strategy: RuntimeInfo["match"]["strategy"]; detailPrefix: string } | null {
  const descendants = getDescendantSessions(database, directory);

  if (descendants.length === 0) {
    return null;
  }

  const runningDescendants = descendants.filter((session) => {
    const runningPart = getRunningPart(database, session.id);
    return runningPart?.status === "running";
  });

  if (runningDescendants.length === 1) {
    const session = runningDescendants[0];

    if (!session) {
      return null;
    }

    return {
      session,
      source: "sqlite-descendant-running",
      strategy: "descendant-running",
      detailPrefix: "matched unique running descendant session under pane cwd",
    };
  }

  const recentCutoff = Date.now() - RECENT_SESSION_WINDOW_MS;
  const recentDescendants = descendants.filter((session) => session.timeUpdated >= recentCutoff);

  if (recentDescendants.length === 1) {
    const session = recentDescendants[0];

    if (!session) {
      return null;
    }

    return {
      session,
      source: "sqlite-descendant-recent",
      strategy: "descendant-recent",
      detailPrefix: "matched unique recent descendant session under pane cwd",
    };
  }

  if (descendants.length === 1) {
    const session = descendants[0];

    if (!session) {
      return null;
    }

    return {
      session,
      source: "sqlite-descendant-only",
      strategy: "descendant-only",
      detailPrefix: "matched only descendant session under pane cwd",
    };
  }

  return null;
}

export function attachRuntimeToPanes(panes: DiscoveredPane[]): PaneRuntimeSummary[] {
  let database: Database;

  try {
    database = openDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return panes.map((entry) => ({
      ...entry,
      runtime: {
        activity: "unknown",
        status: "unknown",
        source: "unmapped",
        match: {
          strategy: "unmapped",
          provider: "none",
          heuristic: false,
        },
        session: null,
        detail: message,
      },
    }));
  }

  try {
    return panes.map((entry) => {
      const exactSession = getSessionMatch(database, entry.pane.currentPath);

      if (exactSession) {
        const runningPart = getRunningPart(database, exactSession.id);

        return {
          ...entry,
          runtime: classifyRuntime(exactSession, runningPart),
        };
      }

      const heuristicMatch = getHeuristicSessionMatch(database, entry.pane.currentPath);

      if (heuristicMatch) {
        const runningPart = getRunningPart(database, heuristicMatch.session.id);

        return {
          ...entry,
          runtime: classifyRuntimeWithSource(
            heuristicMatch.session,
            runningPart,
            heuristicMatch.source,
            heuristicMatch.strategy,
            heuristicMatch.detailPrefix,
          ),
        };
      }

      return {
        ...entry,
        runtime: {
          activity: "unknown",
          status: "unknown",
          source: "unmapped",
          match: {
            strategy: "unmapped",
            provider: "none",
            heuristic: false,
          },
          session: null,
          detail: "no exact or safe heuristic opencode session match for pane cwd",
        },
      };
    });
  } finally {
    database.close();
  }
}
