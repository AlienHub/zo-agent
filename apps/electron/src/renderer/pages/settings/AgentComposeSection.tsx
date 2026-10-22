import { useAppShellContext } from "@/context/AppShellContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, RefreshCw, Pencil, Trash2, Bot, Server } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsInput,
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
  PublicComposeNode,
} from "@craft-agent/shared/agent-compose/types";
import type { ComposeRequest } from "@craft-agent/shared/agent-compose/api-types";

const draftStorage = "zo.compose.agent-draft";
function savedDraft(): any {
  try {
    return JSON.parse(localStorage.getItem(draftStorage) || "null");
  } catch {
    return null;
  }
}
/** Uses Zo settings, dialog and connection components; no parallel chat shell. */
export function AgentComposeSection() {
  const { t } = useTranslation();
  const { activeWorkspaceId } = useAppShellContext();
  const [purpose, setPurpose] = useState<string>(
    () => savedDraft()?.purpose || "",
  );
  const [draftId, setDraftId] = useState<string | null>(() =>
    localStorage.getItem("zo.compose.draft-session"),
  );
  const [generating, setGenerating] = useState(false);
  const [nodes, setNodes] = useState<PublicComposeNode[]>([]),
    [agents, setAgents] = useState<ComposeAgent[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    url: string;
    token: string;
  } | null>(null);
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
  } | null>(() => savedDraft()?.creating || null);
  const [image, setImage] = useState<string>(() => savedDraft()?.image || "");
  useEffect(() => {
    if (creating)
      localStorage.setItem(
        draftStorage,
        JSON.stringify({ creating, purpose, agentForm, image }),
      );
  }, [creating, purpose, agentForm, image]);
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
      setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void request({ action: "list" }).catch(() => {});
  }, [request]);
  const label = (key: string) => t(`settings.agentCompose.${key}`);
  const readDraft = useCallback(
    async (id: string) => {
      const session = await window.electronAPI.getSessionMessages(id);
      if (!session) return;
      setGenerating(session.isProcessing);
      if (session.isProcessing) return;
      const text = [...session.messages]
        .reverse()
        .find((m) => m.role === "assistant" && !m.isIntermediate)?.content;
      if (!text) return;
      try {
        const json = JSON.parse(
          text
            .replace(/^\s*```(?:json)?\s*/, "")
            .replace(/\s*```\s*$/, "")
            .trim(),
        );
        if (
          typeof json.name !== "string" ||
          typeof json.systemPrompt !== "string" ||
          json.systemPrompt.length > 30000
        )
          throw new Error("Invalid agent draft");
        setAgentForm((v) => ({
          ...v,
          name: json.name.slice(0, 100),
          description:
            typeof json.description === "string"
              ? json.description.slice(0, 2000)
              : "",
          systemPrompt: json.systemPrompt,
        }));
        setDraftId(null);
        localStorage.removeItem("zo.compose.draft-session");
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
    if (!creating || !activeWorkspaceId || !purpose.trim()) return;
    setGenerating(true);
    try {
      const result = await request({
        action: "draftAgent",
        workspaceId: activeWorkspaceId,
        nodeId: creating.nodeId,
        purpose,
      });
      if (result.draftSessionId) {
        setDraftId(result.draftSessionId);
        localStorage.setItem("zo.compose.draft-session", result.draftSessionId);
      } else setGenerating(false);
    } catch {
      setGenerating(false);
    }
  };

  return (
    <SettingsSection title="Agent Compose" description={label("description")}>
      <SettingsCard>
        {nodes.map((node) => (
          <SettingsRow key={node.id} label={node.name} description={node.url}>
            <IconButton
              aria-label={label("editServer")}
              disabled={busy}
              onClick={() =>
                setForm({
                  id: node.id,
                  name: node.name,
                  url: node.url,
                  token: "",
                })
              }
              icon={<Pencil className="size-3.5" />}
            />
          </SettingsRow>
        ))}
        <SettingsRow
          label={nodes.length ? label("servers") : label("connectTitle")}
          description={label("connectDescription")}
        >
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
            <Plus className="size-3.5 mr-1" />
            {label("connect")}
          </Button>
        </SettingsRow>
        {nodes.length > 0 && (
          <SettingsRow label={label("agents")}>
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
              <Plus className="size-3.5 mr-1" />
              {label("createAgent")}
            </Button>
          </SettingsRow>
        )}
        {agents.map((agent) => (
          <SettingsRow
            key={`${agent.nodeId}:${agent.projectId}:${agent.agentName}`}
            label={
              <span className="flex items-center gap-2">
                <Bot className="size-4" />
                {agent.name}
              </span>
            }
            description={`${nodes.find((n) => n.id === agent.nodeId)?.name ?? ""} · ${agent.provider} · ${agent.model}${!agent.enabled ? ` · ${label("disabled")}` : ""}`}
          >
            <IconButton
              aria-label={`${label("editAgent")} ${agent.name}`}
              disabled={busy}
              onClick={() => {
                setEditing(agent);
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
              aria-label={`${label("deleteAgent")} ${agent.name}`}
              disabled={busy}
              onClick={() => setDeleting(agent)}
              icon={<Trash2 className="size-3.5" />}
            />
          </SettingsRow>
        ))}
      </SettingsCard>
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
            <label className="block text-sm space-y-1">
              <span>{label("url")}</span>
              <SettingsInput
                placeholder="http://192.168.1.10:8080"
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
              <Button type="submit" disabled={busy}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {label(creating ? "createAgent" : "editAgent")}
            </DialogTitle>
            <DialogDescription>{label("nativeDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const input: ComposeRequest | null = creating
                ? {
                    action: "createAgent",
                    ...creating,
                    ...agentForm,
                    image: image || undefined,
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
            {creating && (
              <div className="space-y-2">
                <SettingsInput
                  label={label("purpose")}
                  value={purpose}
                  onChange={setPurpose}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || generating || !purpose.trim()}
                    onClick={() => void generateDraft()}
                  >
                    {generating ? label("drafting") : label("draft")}
                  </Button>
                  {generating && draftId && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        void window.electronAPI
                          .cancelProcessing(draftId)
                          .then(() => {
                            setGenerating(false);
                            setDraftId(null);
                            localStorage.removeItem("zo.compose.draft-session");
                          });
                      }}
                    >
                      {label("stop")}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {creating && nodes.length > 1 && (
              <Select
                value={creating.nodeId}
                onValueChange={(value) =>
                  setCreating((v) => (v ? { ...v, nodeId: value } : v))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(["name", "description", "model"] as const).map((key) => (
              <label key={key} className="block text-sm space-y-1">
                <span>{label(key === "description" ? "agentDescription" : key)}</span>
                <SettingsInput
                  value={agentForm[key]}
                  onChange={(value) =>
                    setAgentForm((v) => ({ ...v, [key]: value }))
                  }
                />
              </label>
            ))}
            <label className="block text-sm space-y-1">
              <span>{label("systemPrompt")}</span>
              <textarea
                className="w-full rounded-lg border bg-background p-3 text-sm min-h-32"
                value={agentForm.systemPrompt}
                onChange={(e) =>
                  setAgentForm((v) => ({ ...v, systemPrompt: e.target.value }))
                }
              />
            </label>
            {creating && (
              <SettingsInput
                label={label("image")}
                description={label("imageDescription")}
                value={image}
                onChange={setImage}
              />
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={agentForm.enabled}
                onChange={(e) =>
                  setAgentForm((v) => ({ ...v, enabled: e.target.checked }))
                }
              />
              {label("enabled")}
            </label>
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
                  !agentForm.model.trim()
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
    </SettingsSection>
  );
}
