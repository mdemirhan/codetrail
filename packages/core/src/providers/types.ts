import type { Provider, TurnAnchorKind } from "../contracts/canonical";
import type { ProviderMetadata } from "../contracts/providerMetadata";
import type { SqliteDatabase } from "../db/bootstrap";
import type { ResolvedDiscoveryDependencies } from "../discovery/shared";
import type {
  DiscoveredSessionFile,
  DiscoveryConfig,
  ResolvedDiscoveryConfig,
} from "../discovery/types";
import type { IndexingNotice } from "../indexing";
import type { LiveSessionState } from "../live/liveSessionState";
import type { ParseSessionResult } from "../parsing/contracts";
import type {
  ParseProviderEventArgs,
  ParseProviderEventResult,
  ParseProviderPayloadArgs,
  ParsedProviderMessage,
} from "../parsing/providerParserShared";

export type ReadFileText = (filePath: string) => string;

export type ProviderJsonPrimitive = string | number | boolean | null;
export type ProviderJsonValue = ProviderJsonPrimitive | ProviderJsonObject | ProviderJsonArray;
export type ProviderJsonObject = { [key: string]: ProviderJsonValue };
export type ProviderJsonArray = ProviderJsonValue[];
export type ProviderSource = ProviderJsonArray | ProviderJsonObject;

export type ProviderReadSourceResult = {
  payload: ProviderSource;
};

export type ProviderOversizedJsonlEventContext = {
  lineBytes: number;
  primaryByteLimit: number;
  rescueByteLimit: number;
};

export type ProviderOversizedJsonlSanitization = {
  replacedFieldCount: number;
  omittedBytes: number;
  mediaKinds: string[];
  transformedShape: boolean;
};

export type ProviderOversizedJsonlEventResult = {
  event: unknown;
  sanitization: ProviderOversizedJsonlSanitization | null;
};

export type ProviderSourceMetadata = {
  models: string[];
  gitBranch: string | null;
  cwd: string | null;
};

export type ProviderSourceMetadataAccumulator = {
  models: Set<string>;
  gitBranch: string | null;
  cwd: string | null;
};

export type ProviderTimestampNormalizationResult<T extends { createdAt: string }> = {
  message: T;
  previousTimestampMs: number;
};

export type IndexedMessage = ParseSessionResult["messages"][number];

export type PendingCodexUserMessage = {
  message: IndexedMessage;
  nativeTurnId: string | null;
};

export type ExistingProjectCandidate = {
  provider: Provider;
  path: string;
  repositoryUrl: string | null;
};

export type ProviderIndexingProcessingState = {
  currentTurnGroupId: string | null;
  currentNativeTurnId: string | null;
  claudeTurnRootByEventId: Record<string, string>;
  claudeTurnRootEventIds: string[];
  pendingCodexUserMessages: PendingCodexUserMessage[];
};

export type ProviderMessagePreparationArgs = {
  event: unknown;
  eventRecord: Record<string, unknown> | null;
  processingState: ProviderIndexingProcessingState;
  messages: IndexedMessage[];
};

export type ProviderMessagePreparationResult = {
  immediateMessages: IndexedMessage[];
  deferredCodexUserMessages: PendingCodexUserMessage[];
};

export type ProviderFlushPendingMessagesArgs = {
  eventRecord: Record<string, unknown> | null;
  processingState: ProviderIndexingProcessingState;
  flushPending: (classification: TurnAnchorKind) => void;
};

export type ProviderPendingMessageAnnotationArgs = {
  processingState: ProviderIndexingProcessingState;
  pendingMessage: PendingCodexUserMessage;
  classification: TurnAnchorKind;
};

export type ProviderToolEditFileRecord = {
  id: string;
  messageId: string;
  fileOrdinal: number;
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: "exact" | "best_effort";
  beforeHash: string | null;
  afterHash: string | null;
};

export type ProviderRegisterPersistedMessageArgs = {
  discovered: DiscoveredSessionFile;
  providerIndexingState: unknown;
  message: IndexedMessage;
  persistedMessageId: string;
  upsertToolEditFile: (record: ProviderToolEditFileRecord) => void;
};

export type ProviderProcessIndexedEventArgs = {
  db: SqliteDatabase;
  discovered: DiscoveredSessionFile;
  event: unknown;
  sessionDbId: string;
  providerIndexingState: unknown;
  upsertToolEditFile: (record: ProviderToolEditFileRecord) => void;
};

export type ProviderSkipDuplicateEventArgs = {
  discovered: DiscoveredSessionFile;
  event: unknown;
  sessionDbId: string;
  messages: IndexedMessage[];
  hasPersistedMessage: (messageId: string) => boolean;
  onNotice: (notice: IndexingNotice) => void;
};

export type ProviderCleanupMissingSessionsArgs = {
  changedFilePaths: string[];
  discoveredFiles: DiscoveredSessionFile[];
  discoveryConfig: DiscoveryConfig;
  enabledProviderSet: Set<Provider>;
  removeMissingSessionsDuringIncrementalIndexing: boolean;
  listIndexedFilesByPrefix: (prefix: string) => Array<{
    provider: Provider;
    filePath: string;
    projectPath: string;
  }>;
  hasSessionForFile: (filePath: string) => boolean;
  deleteSessionDataForFilePath: (filePath: string) => void;
  deleteIndexedFileByFilePath: (filePath: string) => void;
  deleteCheckpointByFilePath: (filePath: string) => void;
  matchesProjectScope: (provider: Provider, projectPath: string) => boolean;
};

export type ProviderTurnFamilySession = {
  id: string;
  provider: Provider;
  filePath: string;
  sessionIdentity: string | null;
  providerSessionId: string | null;
};

export type ProviderResolveTurnFamilySessionIdsArgs = {
  db: SqliteDatabase;
  projectId: string;
  session: ProviderTurnFamilySession;
};

export type ProviderLiveSessionHooks = {
  applyTranscriptLine: (state: LiveSessionState, line: string, nowMs: number) => LiveSessionState;
  applyHookLine?: (state: LiveSessionState, line: string, nowMs: number) => LiveSessionState;
  readHookTranscriptPath?: (line: string) => string | null;
  transcriptTraceSource?: string;
  hookTraceSource?: string;
};

type CommonProviderAdapter = ProviderMetadata & {
  supportsIncrementalCheckpoints: boolean;
  discoverAll: (
    config: ResolvedDiscoveryConfig,
    dependencies: ResolvedDiscoveryDependencies,
  ) => DiscoveredSessionFile[];
  discoverOne: (
    filePath: string,
    config: ResolvedDiscoveryConfig,
    dependencies: ResolvedDiscoveryDependencies,
  ) => DiscoveredSessionFile | null;
  discoverChanged?: (
    filePath: string,
    config: ResolvedDiscoveryConfig,
    dependencies: ResolvedDiscoveryDependencies,
  ) => DiscoveredSessionFile[];
  sanitizeOversizedJsonlEvent?: (
    event: unknown,
    context: ProviderOversizedJsonlEventContext,
  ) => ProviderOversizedJsonlEventResult;
  parsePayload: (args: ParseProviderPayloadArgs) => ParsedProviderMessage[];
  parseEvent: (args: ParseProviderEventArgs) => ParseProviderEventResult;
  extractSourceMetadata: (payload: ProviderSource) => ProviderSourceMetadata;
  updateSourceMetadataFromEvent?: (
    event: unknown,
    accumulator: ProviderSourceMetadataAccumulator,
  ) => void;
  normalizeMessageTimestamp: <T extends { createdAt: string }>(
    message: T,
    context: { fileMtimeMs: number; previousTimestampMs: number },
  ) => ProviderTimestampNormalizationResult<T>;
  normalizeProjectPaths?: (args: {
    discoveredFiles: DiscoveredSessionFile[];
    existingProjects: ExistingProjectCandidate[];
  }) => DiscoveredSessionFile[];
  createIndexingState?: (discovered: DiscoveredSessionFile) => unknown;
  prepareMessagesForPersistence?: (
    args: ProviderMessagePreparationArgs,
  ) => ProviderMessagePreparationResult;
  updateTurnGroupingBeforeEvent?: (args: {
    processingState: ProviderIndexingProcessingState;
    eventRecord: Record<string, unknown> | null;
  }) => void;
  updateTurnGroupingAfterEvent?: (args: {
    processingState: ProviderIndexingProcessingState;
    eventRecord: Record<string, unknown> | null;
  }) => void;
  flushPendingMessagesBeforeEvent?: (args: ProviderFlushPendingMessagesArgs) => void;
  annotateFlushedPendingMessage?: (args: ProviderPendingMessageAnnotationArgs) => IndexedMessage;
  registerPersistedMessage?: (args: ProviderRegisterPersistedMessageArgs) => void;
  processIndexedEvent?: (args: ProviderProcessIndexedEventArgs) => void;
  shouldSkipDuplicateEvent?: (args: ProviderSkipDuplicateEventArgs) => boolean;
  cleanupMissingSessions?: (args: ProviderCleanupMissingSessionsArgs) => number;
  resolveTurnFamilySessionIds?: (args: ProviderResolveTurnFamilySessionIdsArgs) => string[];
  handlesToolEditsNatively?: boolean;
  liveSession?: ProviderLiveSessionHooks;
};

export type JsonlStreamProviderAdapter = CommonProviderAdapter & {
  sourceFormat: "jsonl_stream";
};

export type MaterializedJsonProviderAdapter = CommonProviderAdapter & {
  sourceFormat: "materialized_json";
  readSource: (
    discovered: DiscoveredSessionFile,
    readFileText: ReadFileText,
  ) => ProviderReadSourceResult | null;
};

export type ProviderAdapter = JsonlStreamProviderAdapter | MaterializedJsonProviderAdapter;
