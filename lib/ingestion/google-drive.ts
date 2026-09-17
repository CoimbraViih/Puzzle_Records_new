import { google, type drive_v3 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { upsertPipelineItem } from "./pipeline-items";

type DriveChange = {
  fileId?: string | null;
  removed?: boolean | null;
  file?: Pick<drive_v3.Schema$File, "id" | "parents" | "trashed"> | null;
};

export function isRelevantDriveChange(change: DriveChange, watchedFolderId: string): boolean {
  if (change.removed) return false;
  const file = change.file;
  if (!file || file.trashed) return false;
  return (file.parents ?? []).includes(watchedFolderId);
}

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

type DriveSyncState = {
  id: boolean;
  page_token: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expiration: string | null;
  updated_at: string;
};

async function getSyncState(): Promise<DriveSyncState | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("drive_sync_state").select("*").eq("id", true).maybeSingle();
  if (error) throw error;
  return data as DriveSyncState | null;
}

async function saveSyncState(patch: Record<string, unknown>) {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("drive_sync_state")
    .upsert({ id: true, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

/**
 * Processa mudanças novas na pasta observada desde o último pageToken salvo.
 * Chamada tanto pelo webhook (push notification) quanto pelo polling (cron) —
 * é o único lugar que efetivamente cria pipeline_items a partir do Drive,
 * garantindo que os dois caminhos usem a mesma lógica de dedupe.
 */
export async function syncDriveChanges() {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
  const state = await getSyncState();

  let pageToken = state?.page_token ?? undefined;
  if (!pageToken) {
    const start = await drive.changes.getStartPageToken({});
    pageToken = start.data.startPageToken!;
    await saveSyncState({ page_token: pageToken });
  }

  let processed = 0;
  let nextPageToken: string | undefined = pageToken;

  while (nextPageToken) {
    const res: { data: drive_v3.Schema$ChangeList } = await drive.changes.list({
      pageToken: nextPageToken,
      fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,parents,trashed,mimeType,owners))",
    });

    for (const change of res.data.changes ?? []) {
      if (!isRelevantDriveChange(change, folderId)) continue;
      const file = change.file!;
      await upsertPipelineItem({
        origin: "drive",
        externalId: file.id!,
        title: file.name ?? null,
        author: file.owners?.[0]?.emailAddress ?? null,
        mimeType: file.mimeType ?? null,
        driveFileId: file.id!,
        metadata: {},
      });
      processed += 1;
    }

    if (res.data.newStartPageToken) {
      await saveSyncState({ page_token: res.data.newStartPageToken });
      nextPageToken = undefined;
    } else {
      nextPageToken = res.data.nextPageToken ?? undefined;
    }
  }

  return { processed };
}

/**
 * Cria (ou renova, se estiver perto de expirar) o watch channel do Drive.
 * O Drive não permite "watch" direto numa pasta — por isso observamos o feed
 * de changes inteiro e filtramos por pasta em isRelevantDriveChange.
 */
export async function ensureDriveWatchChannel() {
  const drive = getDriveClient();
  const state = await getSyncState();

  const expiresInMs = state?.channel_expiration ? new Date(state.channel_expiration).getTime() - Date.now() : -1;
  if (expiresInMs > 24 * 60 * 60 * 1000) {
    return { renewed: false };
  }

  if (state?.channel_id && state.channel_resource_id) {
    await drive.channels
      .stop({ requestBody: { id: state.channel_id, resourceId: state.channel_resource_id } })
      .catch(() => {});
  }

  if (!state?.page_token) {
    const start = await drive.changes.getStartPageToken({});
    await saveSyncState({ page_token: start.data.startPageToken! });
  }

  const channelId = crypto.randomUUID();
  const currentState = await getSyncState();
  const res = await drive.changes.watch({
    pageToken: currentState!.page_token!,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${process.env.PUBLIC_BASE_URL}/api/drive/webhook`,
      token: process.env.GOOGLE_DRIVE_WEBHOOK_TOKEN,
    },
  });

  await saveSyncState({
    channel_id: channelId,
    channel_resource_id: res.data.resourceId,
    channel_expiration: res.data.expiration ? new Date(Number(res.data.expiration)).toISOString() : null,
  });

  return { renewed: true };
}
