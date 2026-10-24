import { useNavigation } from "@/contexts/NavigationContext";
import { routes } from "@/lib/navigate";
import { parseAgentDraft } from "@craft-agent/shared/agent-compose/draft";
import { useAppShellContext } from "@/context/AppShellContext";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Info_DataTable,
  INFO_TABLE_HEADER_CLASS,
} from "@/components/info/Info_DataTable";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, RefreshCw, Pencil, Trash2, Bot, Server, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button, IconButton } from "@/components/ui/button";
import {
  SettingsSection,
  SettingsPage,
  SettingsCard,
  SettingsInput,
  SettingsToggle,
} from "@/components/settings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import type {
  ComposeAgent,
  ComposeSshStatus,
  ComposeModelOption,
  ComposeImageOption,
  ComposeConnectionTest,
  PublicComposeNode,
} from "@craft-agent/shared/agent-compose/types";
import type { ComposeRequest } from "@craft-agent/shared/agent-compose/api-types";

const draftStorage = "zo.compose.agent-draft";
// Native image references can be hundreds of characters: never size a menu from its content.
const composeSelectContentClass = "w-[var(--radix-select-trigger-width)] min-w-0 max-w-[calc(100vw-2rem)] max-h-[min(20rem,var(--radix-select-content-available-height))] [&_[data-radix-select-viewport]]:min-w-0";
// Keep the shared field material, with a quiet inset focus line inside these large editor panes.
const agentTextareaClass = "rounded-xl p-3 [--focus-ring:var(--border-strong)] [--accent-tint:transparent]";
function savedDraft(): any {
  try {
    return JSON.parse(localStorage.getItem(draftStorage) || "null");
  } catch {
    return null;
  }
}
/** Uses Zo settings, dialog and connection components; no parallel chat shell. */
export default function AgentComposeSettingsPage() {
  const { t } = useTranslation();
  const { activeWorkspaceId, llmConnections, workspaceDefaultLlmConnection } = useAppShellContext();
  const { navigate } = useNavigation();
  const [draftConnectionSlug, setDraftConnectionSlug] = useState("");
  const draftConnections = llmConnections.filter((connection) => !connection.compose && !connection.composeUnavailable && connection.isAuthenticated);
  const draftConnection = draftConnections.find((connection) => connection.slug === draftConnectionSlug)
    ?? draftConnections.find((connection) => connection.slug === workspaceDefaultLlmConnection)
    ?? draftConnections.find((connection) => connection.isDefault)
    ?? draftConnections[0];
  const [purpose, setPurpose] = useState<string>(
    () => savedDraft()?.purpose || "",
  );
  const [draftId, setDraftId] = useState<string | null>(() =>
    localStorage.getItem("zo.compose.draft-session"),
  );
  const [generating, setGenerating] = useState(false);
  const stoppedDrafts = useRef(new Set<string>());
  const [nodes, setNodes] = useState<PublicComposeNode[]>([]),
    [agents, setAgents] = useState<ComposeAgent[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    url: string;
    token: string;
    ssh?: { host: string };
  } | null>(null);
  const [connectionDialogContainer, setConnectionDialogContainer] = useState<HTMLFormElement | null>(null);
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  const [sshStatuses, setSshStatuses] = useState<Record<string, ComposeSshStatus>>({});
  useEffect(() => {
    if (!form) return;
    let active = true;
    void window.electronAPI.agentCompose({ action: "sshHosts" })
      .then((result) => { if (active) setSshHosts(result.sshHosts ?? []); }).catch(() => {});
    return () => { active = false; };
  }, [!!form]);
  const hasSshNodes = nodes.some((node) => !!node.ssh);
  useEffect(() => {
    if (!hasSshNodes) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        if (document.visibilityState === "visible") {
          const result = await window.electronAPI.agentCompose({ action: "sshStatus" });
          if (active) setSshStatuses((previous) => {
            const next = result.sshStatuses ?? {};
            return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
          });
        }
      } catch { /* transport reconnection is owned by the app */ }
      finally { if (active) timer = setTimeout(() => void update(), 3000); }
    };
    void update();
    return () => { active = false; clearTimeout(timer); };
  }, [hasSshNodes]);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [nodeTests, setNodeTests] = useState<Record<string, { url: string; sshHost?: string; result: ComposeConnectionTest }>>({});
  const [formTest, setFormTest] = useState<ComposeConnectionTest | null>(null);
  const formTestGeneration = useRef(0);
  useEffect(() => {
    formTestGeneration.current++;
    setFormTest(null);
  }, [form?.id, form?.url, form?.token, form?.ssh?.host]);
  const connectionTestMessage = (result: ComposeConnectionTest) => result.ok
    ? t("settings.agentCompose.testConnected", { ms: result.latencyMs ?? 0 })
    : t(`settings.agentCompose.testError.${result.code}`);
  const testConnection = async (node?: PublicComposeNode) => {
    if (testingKey || (!node && !form)) return;
    const key = node?.id ?? "form";
    const generation = formTestGeneration.current;
    setTestingKey(key);
    if (node) setNodeTests((previous) => { const next = { ...previous }; delete next[node.id]; return next; });
    else setFormTest(null);
    let result: ComposeConnectionTest;
    try {
      const response = await window.electronAPI.agentCompose(node
        ? { action: "testNode", nodeId: node.id }
        : { action: "testNode", node: { ...form! } });
      result = response.connectionTest ?? { ok: false, code: "server_error" };
    } catch {
      result = { ok: false, code: "server_error" };
    }
    if (node) setNodeTests((previous) => ({ ...previous, [node.id]: { url: node.url, sshHost: node.ssh?.host, result } }));
    else if (generation === formTestGeneration.current) setFormTest(result);
    setTestingKey(null);
  };
  const [editing, setEditing] = useState<ComposeAgent | null>(null),
    [agentForm, setAgentForm] = useState<{
      name: string;
      description: string;
      model: string;
      systemPrompt: string;
      enabled: boolean;
    }>(
      () =>
        savedDraft()?.agentForm || {
          name: "",
          description: "",
          model: "",
          systemPrompt: "",
          enabled: true,
        },
    );
  const [creating, setCreating] = useState<{
    requestId: string;
    nodeId: string;
  } | null>(null);
  const creatingRef = useRef(creating);
  useEffect(() => { creatingRef.current = creating; }, [creating]);
  const [image, setImage] = useState<string>(() => savedDraft()?.image || "");
  useEffect(() => {
    if (creating)
      localStorage.setItem(
        draftStorage,
        JSON.stringify({ creating, purpose, agentForm, image }),
      );
  }, [creating, purpose, agentForm, image]);
  const modelNodeId = creating?.nodeId ?? editing?.nodeId;
  const [modelOptions, setModelOptions] = useState<ComposeModelOption[]>([]);
  const [agentDialogContainer, setAgentDialogContainer] = useState<HTMLFormElement | null>(null);
  const [imageOptions, setImageOptions] = useState<ComposeImageOption[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesUnavailable, setImagesUnavailable] = useState(false);
  const [manualImage, setManualImage] = useState(false);
  const [imageRefresh, setImageRefresh] = useState(0);
  useEffect(() => {
    setManualImage(false);
    setImageOptions([]);
    setImagesUnavailable(false);
    setImagesLoading(!!modelNodeId);
    if (!modelNodeId) return;
    let active = true;
    void window.electronAPI.agentCompose({ action: "images", nodeId: modelNodeId })
      .then((result) => {
        if (!active) return;
        setImageOptions(result.images ?? []);
        setImagesUnavailable(!!result.imagesUnavailable);
      })
      .catch(() => { if (active) setImagesUnavailable(true); })
      .finally(() => { if (active) setImagesLoading(false); });
    return () => { active = false; };
  }, [modelNodeId, imageRefresh]);
  const selectedImageOptions = image && !imageOptions.some((option) => option.ref === image)
    ? [{ ref: image, local: false, usedByPi: false }, ...imageOptions]
    : imageOptions;
  const canInheritImage = !!creating && agents.some((agent) => agent.nodeId === creating.nodeId && agent.provider === "pi");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  useEffect(() => {
    setManualModel(false);
    setModelOptions([]);
    setCatalogUnavailable(false);
    if (!modelNodeId) return;
    let active = true;
    setModelsLoading(true);
    void window.electronAPI.agentCompose({ action: "models", nodeId: modelNodeId })
      .then((result) => {
        if (!active) return;
        setModelOptions(result.models ?? []);
        setCatalogUnavailable(!!result.catalogUnavailable);
      })
      .catch(() => { if (active) setCatalogUnavailable(true); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [modelNodeId]);
  const selectedModelOptions = agentForm.model && !modelOptions.some((model) => model.id === agentForm.model)
    ? [{ id: agentForm.model, name: agentForm.model }, ...modelOptions]
    : modelOptions;
  const [deleting, setDeleting] = useState<ComposeAgent | null>(null);
  const request = useCallback(async (input: ComposeRequest) => {
    setBusy(true);
    setError("");
    try {
      const result = await window.electronAPI.agentCompose(input);
      setNodes(result.nodes);
      setAgents(result.agents);
      if (result.warnings.length) setError(result.warnings.join("\n"));
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(t(`settings.agentCompose.testError.${message}`, { defaultValue: message }));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [t]);
  useEffect(() => {
    void request({ action: "list" }).catch(() => {});
  }, [request]);
  const label = (key: string) => t(`settings.agentCompose.${key}`);
  const readDraft = useCallback(
    async (id: string) => {
      if (stoppedDrafts.current.has(id)) return;
      const session = await window.electronAPI.getSessionMessages(id);
      if (!session || stoppedDrafts.current.has(id)) return;
      setGenerating(session.isProcessing);
      if (session.isProcessing) return;
      const text = [...session.messages]
        .reverse()
        .find((m) => m.role === "assistant" && !m.isIntermediate)?.content;
      setDraftId(null);
      localStorage.removeItem("zo.compose.draft-session");
      if (session.messages.some((message) => message.role === "error")) {
        setError(t("settings.agentCompose.draftFailed"));
        return;
      }
      try {
        const draft = parseAgentDraft(text || "");
        const persisted = savedDraft();
        if (persisted) localStorage.setItem(draftStorage, JSON.stringify({
          ...persisted, agentForm: { ...persisted.agentForm, ...draft },
        }));
        // A background result belongs to the creation draft, not to an agent
        // the user may have opened for editing while it was running.
        if (creatingRef.current) {
          setAgentForm((previous) => ({ ...previous, ...draft }));
          setError("");
        }
      } catch {
        setError(t("settings.agentCompose.invalidDraft"));
      }
    },
    [t],
  );
  useEffect(() => {
    if (!draftId) return;
    void readDraft(draftId).catch((e) => setError(String(e)));
    const off = window.electronAPI.onSessionEvent((e) => {
      if (
        e.sessionId === draftId &&
        (e.type === "complete" || e.type === "interrupted")
      )
        void readDraft(draftId).catch(() => {});
    });
    const reconnect = window.electronAPI.onReconnected(() => {
      void readDraft(draftId).catch(() => {});
    });
    return () => {
      off();
      reconnect();
    };
  }, [draftId, readDraft]);
  const generateDraft = async () => {
    if (!creating || !activeWorkspaceId || !purpose.trim() || !draftConnection || generating) return;
    setGenerating(true);
    setError("");
    try {
      const result = await window.electronAPI.agentCompose({
        action: "draftAgent",
        llmConnection: draftConnection.slug,
        workspaceId: activeWorkspaceId,
        nodeId: creating.nodeId,
        purpose,
      });
      if (result.draftSessionId) {
        setDraftId(result.draftSessionId);
        localStorage.setItem("zo.compose.draft-session", result.draftSessionId);
      } else setGenerating(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setGenerating(false);
    }
  };

  const header = (text: string) => (
    <span className={`block px-2.5 py-1.5 ${INFO_TABLE_HEADER_CLASS}`}>
      {text}
    </span>
  );
  const cellClass = "px-2.5 py-2 text-label";
  const serverColumns: ColumnDef<PublicComposeNode>[] = [
    {
      accessorKey: "name",
      enableResizing: false,
      header: () => header(label("name")),
      cell: ({ row }) => (
        <div className={`${cellClass} flex items-center gap-2 font-medium`}>
          <Server className="size-4 shrink-0 text-tertiary" />
          {row.original.name}
        </div>
      ),
      size: 160,
      minSize: 140,
    },
    {
      accessorKey: "url",
      enableResizing: false,
      header: () => header(label("url")),
      cell: ({ row }) => (
        <div className={`${cellClass} break-all text-secondary`}>
          {row.original.url}
          {row.original.ssh && <div role="status" className="mt-1 text-label-sm text-tertiary">
            SSH · {row.original.ssh.host} · {label(`sshState.${sshStatuses[row.original.id]?.state ?? "idle"}`)}
            {sshStatuses[row.original.id]?.error && <span className="block text-destructive">{label(`testError.${sshStatuses[row.original.id]!.error}`)}</span>}
          </div>}
          {nodeTests[row.original.id]?.url === row.original.url && nodeTests[row.original.id]?.sshHost === row.original.ssh?.host && (!row.original.ssh || sshStatuses[row.original.id]?.state === "connected") && (
            <div role="status" className={`mt-1 text-label-sm ${nodeTests[row.original.id]!.result.ok ? "text-secondary" : "text-destructive"}`}>
              {connectionTestMessage(nodeTests[row.original.id]!.result)}
            </div>
          )}
        </div>
      ),
      meta: { fillWidth: true },
    },
    {
      id: "actions",
      enableResizing: false,
      header: () => null,
      size: 140,
      minSize: 140,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1 pr-1.5">
          <Button type="button" variant="ghost" size="sm"
            aria-label={`${label("testConnection")} ${row.original.name}`}
            disabled={busy || !!testingKey}
            onClick={() => void testConnection(row.original)}>
            {testingKey === row.original.id && <RefreshCw className="size-3.5 animate-spin" />}
            {label(testingKey === row.original.id ? "testingConnection" : "testConnection")}
          </Button>
          <IconButton
            aria-label={`${label("editServer")} ${row.original.name}`}
            disabled={busy}
            onClick={() => setForm({ id: row.original.id, name: row.original.name, url: row.original.url, token: "", ssh: row.original.ssh })}
            icon={<Pencil className="size-3.5" />}
          />
        </div>
      ),
    },
  ];
  const agentColumns: ColumnDef<ComposeAgent>[] = [
    {
      accessorKey: "name",
      enableResizing: false,
      header: () => header(label("agents")),
      cell: ({ row }) => (
        <div className={`${cellClass} flex items-center gap-2 font-medium`}>
          <Bot className="size-4 shrink-0 text-tertiary" />
          <span>
            {row.original.name}
            {!row.original.enabled && (
              <span className="ml-2 text-label-sm font-normal text-tertiary">
                {label("disabled")}
              </span>
            )}
          </span>
        </div>
      ),
      size: 160,
      minSize: 140,
    },
    {
      id: "server",
      enableResizing: false,
      accessorFn: (agent) =>
        nodes.find((node) => node.id === agent.nodeId)?.name ?? "",
      header: () => header(label("servers")),
      cell: ({ getValue }) => (
        <div className={`${cellClass} text-secondary`}>
          {String(getValue())}
        </div>
      ),
      size: 140,
      minSize: 140,
    },
    {
      accessorKey: "model",
      enableResizing: false,
      header: () => header(label("model")),
      cell: ({ row }) => (
        <div className={cellClass}>
          <div>{row.original.model}</div>
          <div className="text-label-sm text-tertiary">
            {row.original.provider}
          </div>
        </div>
      ),
      meta: { fillWidth: true },
    },
    {
      id: "actions",
      enableResizing: false,
      header: () => null,
      size: 80,
      minSize: 80,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1 pr-1.5">
          <IconButton
            aria-label={`${label("editAgent")} ${row.original.name}`}
            disabled={busy}
            onClick={() => {
              const agent = row.original;
              setEditing(agent);
              setImage(String(agent.spec.image || ""));
              setAgentForm({
                name: agent.name,
                description: String(agent.spec.description || ""),
                model: agent.model,
                systemPrompt: String(agent.spec.systemPrompt || ""),
                enabled: agent.enabled,
              });
            }}
            icon={<Pencil className="size-3.5" />}
          />
          <IconButton
            aria-label={`${label("deleteAgent")} ${row.original.name}`}
            disabled={busy}
            onClick={() => setDeleting(row.original)}
            icon={<Trash2 className="size-3.5" />}
          />
        </div>
      ),
    },
  ];

  return (
    <SettingsPage
      title="Agent Compose"
      description={label("description")}
      actions={
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={label("refresh")}
            disabled={busy}
            onClick={() => void request({ action: "refresh" }).catch(() => {})}
            icon={
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            }
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setForm({ name: "", url: "", token: "" })}
          >
            <Plus className="size-3.5" />
            {label("connect")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <SettingsCard>
          <Info_DataTable
            columns={serverColumns}
            data={nodes}
            maxHeight={280}
            emptyContent={label("connectTitle")}
          />
        </SettingsCard>
        {nodes.length > 0 && (
          <SettingsSection
            title={label("agents")}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const previous = savedDraft();
                  if (previous) {
                    setCreating(previous.creating);
                    setPurpose(previous.purpose || "");
                    setAgentForm(previous.agentForm);
                    setImage(previous.image || "");
                    return;
                  }
                  setCreating({
                    requestId: crypto.randomUUID(),
                    nodeId: nodes[0]!.id,
                  });
                  setAgentForm({
                    name: "",
                    description: "",
                    model: agents.find((a) => a.provider === "pi")?.model || "",
                    systemPrompt: "",
                    enabled: true,
                  });
                  setImage("");
                }}
              >
                <Plus className="size-3.5" />
                {label("createAgent")}
              </Button>
            }
          >
            <SettingsCard>
              <Info_DataTable
                columns={agentColumns}
                data={agents}
                maxHeight={360}
                emptyContent={label("createAgent")}
              />
            </SettingsCard>
          </SettingsSection>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="text-sm text-destructive whitespace-pre-wrap mt-2"
        >
          {error}
        </p>
      )}
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open && !busy) setForm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label("connectTitle")}</DialogTitle>
            <DialogDescription>{label("tokenDescription")}</DialogDescription>
          </DialogHeader>
          <form
            ref={setConnectionDialogContainer}
            onSubmit={(e) => {
              e.preventDefault();
              if (form)
                void request({ action: "saveNode", node: form })
                  .then(() => {
                    setForm(null);
                    toast.success(label("connected"));
                  })
                  .catch(() => {});
            }}
            className="space-y-4"
          >
            <label className="block text-sm space-y-1">
              <span>{label("name")}</span>
              <SettingsInput
                value={form?.name || ""}
                onChange={(value) =>
                  setForm((v) => (v ? { ...v, name: value } : v))
                }
              />
            </label>
            <div className="space-y-1">
              <span className="text-sm" id="compose-transport-label">{label("connectionType")}</span>
              <Select value={form?.ssh ? "ssh" : "direct"} onValueChange={(value) => setForm((v) => v ? { ...v, ssh: value === "ssh" ? { host: "" } : undefined, url: value === "ssh" && !v.url ? "http://127.0.0.1:8080" : v.url } : v)}>
                <SelectTrigger aria-labelledby="compose-transport-label" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent container={connectionDialogContainer}><SelectItem value="direct">{label("directConnection")}</SelectItem><SelectItem value="ssh">{label("sshConnection")}</SelectItem></SelectContent>
              </Select>
            </div>
            {form?.ssh && <label className="block text-sm space-y-1">
              <span>{label("sshHost")}</span>
              <div className="relative">
                <Input list="compose-ssh-hosts" placeholder="my-server" value={form.ssh.host}
                  className="pr-9 [&::-webkit-calendar-picker-indicator]:opacity-0"
                  onChange={(event) => setForm((v) => v?.ssh ? { ...v, ssh: { host: event.target.value } } : v)} />
                {sshHosts.length > 0 && <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-tertiary" />}
              </div>
              <datalist id="compose-ssh-hosts">{sshHosts.map((host) => <option key={host} value={host} />)}</datalist>
              <span className="block text-label-sm text-secondary">{label("sshDescription")}</span>
            </label>}
            <label className="block text-sm space-y-1">
              <span>{label(form?.ssh ? "sshDaemonUrl" : "url")}</span>
              <SettingsInput
                placeholder={form?.ssh ? "http://127.0.0.1:8080" : "http://192.168.1.10:8080"}
                value={form?.url || ""}
                onChange={(value) =>
                  setForm((v) => (v ? { ...v, url: value } : v))
                }
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>Token</span>
              <SettingsInput
                type="password"
                placeholder={form?.id ? label("keepToken") : ""}
                value={form?.token || ""}
                onChange={(value) =>
                  setForm((v) => (v ? { ...v, token: value } : v))
                }
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {formTest && <p role="status" className={`text-label-sm ${formTest.ok ? "text-secondary" : "text-destructive"}`}>
              {connectionTestMessage(formTest)}
            </p>}
            <DialogFooter>
              {form?.id && (
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (form.id)
                      void request({ action: "removeNode", nodeId: form.id })
                        .then(() => setForm(null))
                        .catch(() => {});
                  }}
                >
                  {label("disconnect")}
                </Button>
              )}
              <Button type="button" variant="outline" disabled={busy || !!testingKey || !form?.url.trim()}
                onClick={() => void testConnection()}>
                {testingKey === "form" && <RefreshCw className="size-3.5 animate-spin" />}
                {label(testingKey === "form" ? "testingConnection" : "testConnection")}
              </Button>
              <Button type="submit" disabled={busy || !!testingKey}>
                {busy ? label("connecting") : label("connect")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing || !!creating}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditing(null);
            setCreating(null);
          }
        }}
      >
        <DialogContent className={creating ? "flex max-h-[88vh] flex-col overflow-hidden sm:max-w-[1020px]" : "flex max-h-[88vh] flex-col overflow-hidden sm:max-w-xl"}>
          <DialogHeader>
            <DialogTitle>
              {label(creating ? "createAgent" : "editAgent")}
            </DialogTitle>
            <DialogDescription>{label("nativeDescription")}</DialogDescription>
          </DialogHeader>
          <form
            ref={setAgentDialogContainer}
            className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const input: ComposeRequest | null = creating
                ? {
                    action: "createAgent",
                    ...creating,
                    ...agentForm,
                    image: image.trim() || undefined,
                  }
                : editing
                  ? {
                      action: "editAgent",
                      binding: editing,
                      specHash: editing.specHash,
                      agent: {
                        ...editing.spec,
                        displayName: agentForm.name,
                        description: agentForm.description,
                        model: agentForm.model,
                        systemPrompt: agentForm.systemPrompt,
                        enabled: agentForm.enabled,
                        ...(image.trim() ? { image: image.trim() } : {}),
                      },
                    }
                  : null;
              if (input)
                void request(input)
                  .then(() => {
                    if (creating) {
                      localStorage.removeItem(draftStorage);
                      setPurpose("");
                    }
                    setEditing(null);
                    setCreating(null);
                  })
                  .catch(() => {});
            }}
          >
            <div className={creating ? "grid min-h-0 min-w-0 w-full flex-1 gap-5 overflow-y-auto md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:overflow-hidden" : "min-h-0 min-w-0 w-full overflow-y-auto"}>
            {creating && (
              <section className="flex min-h-0 min-w-0 flex-col gap-4 md:overflow-y-auto md:border-r md:border-border/50 md:pr-5">
                {nodes.length > 1 && <div className="space-y-1.5">
                  <label id="compose-create-server-label" className="text-sm">{label("servers")}</label>
                  <Select value={creating.nodeId} disabled={busy || generating} onValueChange={(nodeId) => {
                    setCreating((previous) => previous ? { ...previous, nodeId } : previous);
                    setImage("");
                    setAgentForm((previous) => ({ ...previous, model: agents.find((agent) => agent.nodeId === nodeId && agent.provider === "pi")?.model || "" }));
                  }}>
                    <SelectTrigger aria-labelledby="compose-create-server-label"><SelectValue /></SelectTrigger>
                    <SelectContent container={agentDialogContainer} className={composeSelectContentClass}>
                      {nodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>}
                <label htmlFor="compose-agent-purpose" className="text-sm font-medium">{label("purpose")}</label>
                <Textarea id="compose-agent-purpose" style={{ fieldSizing: "fixed" }} className={`${agentTextareaClass} min-h-40 flex-1 resize-none md:min-h-56`}
                  placeholder={label("purposePlaceholder")} value={purpose} disabled={generating || busy}
                  onChange={(event) => setPurpose(event.target.value)} />
                {draftConnections.length > 1 ? (
                  <Select value={draftConnection?.slug} onValueChange={setDraftConnectionSlug} disabled={generating}>
                    <SelectTrigger aria-label={label("draftConnection")}><SelectValue /></SelectTrigger>
                    <SelectContent container={agentDialogContainer} className={composeSelectContentClass}>
                      {draftConnections.map((connection) => <SelectItem key={connection.slug} value={connection.slug}>{connection.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : draftConnection ? (
                  <p className="text-label-sm text-tertiary">{t("settings.agentCompose.draftUsing", { name: draftConnection.name })}</p>
                ) : (
                  <div className="flex items-center gap-2 text-label-sm text-tertiary">
                    <span>{label("draftNeedsConnection")}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => {
                      setCreating(null);
                      void navigate(routes.view.settings("ai"));
                    }}>{label("configureAI")}</Button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || generating || !purpose.trim() || !draftConnection}
                    onClick={() => void generateDraft()}
                  >
                    {generating ? label("drafting") : label("draft")}
                  </Button>
                  {generating && draftId && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        stoppedDrafts.current.add(draftId);
                        setError("");
                        void window.electronAPI
                          .cancelProcessing(draftId)
                          .then(() => {
                            setGenerating(false);
                            setDraftId(null);
                            localStorage.removeItem("zo.compose.draft-session");
                          }).catch((error) => {
                            stoppedDrafts.current.delete(draftId);
                            setError(error instanceof Error ? error.message : String(error));
                          });
                      }}
                    >
                      {label("stop")}
                    </Button>
                  )}
                </div>
              </section>
            )}
            <section className="min-w-0 space-y-4 md:overflow-y-auto md:pr-1">
              {creating && <h3 className="text-sm font-medium">{label("configuration")}</h3>}
            {(["name", "description"] as const).map((key) => (
              <label key={key} className="block text-sm space-y-1">
                <span>
                  {label(key === "description" ? "agentDescription" : key)}
                </span>
                <SettingsInput
                  value={agentForm[key]}
                  onChange={(value) =>
                    setAgentForm((v) => ({ ...v, [key]: value }))
                  }
                />
              </label>
            ))}
            <div className="space-y-1.5">
              <label id="compose-agent-model-label" className="block text-sm">{label("model")}</label>
              <Select
                value={manualModel ? "__zo_custom_model__" : agentForm.model}
                disabled={busy || modelsLoading}
                onValueChange={(value) => {
                  if (value === "__zo_custom_model__") setManualModel(true);
                  else {
                    setManualModel(false);
                    setAgentForm((form) => ({ ...form, model: value }));
                  }
                }}
              >
                <SelectTrigger aria-labelledby="compose-agent-model-label" className="w-full">
                  <SelectValue placeholder={label(modelsLoading ? "loadingModels" : "selectModel")} />
                </SelectTrigger>
                <SelectContent container={agentDialogContainer} className={composeSelectContentClass}>
                  {selectedModelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id} title={model.name} className="min-w-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate">{model.name}</SelectItem>
                  ))}
                  <SelectItem value="__zo_custom_model__">{label("customModel")}</SelectItem>
                </SelectContent>
              </Select>
              {manualModel && <SettingsInput
                aria-label={label("customModel")}
                placeholder={label("modelId")}
                value={agentForm.model}
                onChange={(model) => setAgentForm((form) => ({ ...form, model }))}
              />}
              <p className="text-label-sm text-tertiary">{label(catalogUnavailable ? "modelCatalogUnavailable" : "modelDefaultDescription")}</p>
            </div>
            <label className="block text-sm space-y-1">
              <span>{label("systemPrompt")}</span>
              <Textarea
                style={{ fieldSizing: "fixed" }}
                aria-label={label("systemPrompt")}
                className={`${agentTextareaClass} min-h-40 resize-y`}
                value={agentForm.systemPrompt}
                onChange={(e) =>
                  setAgentForm((v) => ({ ...v, systemPrompt: e.target.value }))
                }
              />
            </label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label id="compose-agent-image-label" className="text-sm">{label("image")}</label>
                <IconButton type="button" aria-label={label("refreshImages")} disabled={busy || imagesLoading} onClick={() => setImageRefresh((value) => value + 1)} icon={<RefreshCw className={`size-3.5 ${imagesLoading ? "animate-spin" : ""}`} />} />
              </div>
              <Select value={manualImage ? "__zo_custom_image__" : image || (canInheritImage ? "__zo_inherit_image__" : "")} disabled={busy || imagesLoading}
                onValueChange={(value) => {
                  setManualImage(value === "__zo_custom_image__");
                  if (value !== "__zo_custom_image__") setImage(value === "__zo_inherit_image__" ? "" : value);
                }}>
                <SelectTrigger aria-labelledby="compose-agent-image-label" title={image || undefined} className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0">
                  <SelectValue placeholder={label(imagesLoading ? "loadingImages" : "selectImage")}>
                    {manualImage ? label("customImage") : image || (canInheritImage ? label("inheritImage") : undefined)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent container={agentDialogContainer} className={composeSelectContentClass}>
                  {canInheritImage && <SelectItem value="__zo_inherit_image__">{label("inheritImage")}</SelectItem>}
                  {selectedImageOptions.map((option) => <SelectItem key={option.ref} value={option.ref} textValue={option.ref} title={option.ref}
                    className="min-w-0 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{option.ref}</span>
                      {(option.usedByPi || option.platform) && <span className="shrink-0 text-xs text-tertiary">{option.usedByPi ? label("piImage") : option.platform}</span>}
                    </span>
                  </SelectItem>)}
                  <SelectItem value="__zo_custom_image__">{label("customImage")}</SelectItem>
                </SelectContent>
              </Select>
              {manualImage && <SettingsInput aria-label={label("customImage")} placeholder={label("imageReference")} value={image} onChange={setImage} />}
              <p role={imagesUnavailable ? "status" : undefined} className="text-label-sm text-tertiary">{label(imagesUnavailable ? "imageCatalogUnavailable" : imageOptions.length ? "imageDescription" : "noImages")}</p>
            </div>
            <SettingsToggle
              label={label("enabled")}
              inCard={false}
              checked={agentForm.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => setAgentForm((form) => ({ ...form, enabled }))}
            />
            </section>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                disabled={
                  busy ||
                  generating ||
                  !agentForm.name.trim() ||
                  !agentForm.model.trim() ||
                  (manualImage && !image.trim()) ||
                  (!!creating && !canInheritImage && !image.trim())
                }
                type="submit"
              >
                {label("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {label("deleteAgent")} {deleting?.name}
            </DialogTitle>
            <DialogDescription>{label("deleteDescription")}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={busy}
            >
              {label("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting)
                  void request({
                    action: "editAgent",
                    binding: deleting,
                    specHash: deleting.specHash,
                    agent: deleting.spec,
                    remove: true,
                  })
                    .then(() => setDeleting(null))
                    .catch(() => {});
              }}
            >
              {label("deleteAgent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
