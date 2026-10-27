import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComposeAgent } from "@craft-agent/shared/agent-compose/types";
import type { AgentRemoteMcp, RemoteMcpServer } from "@craft-agent/shared/agent-compose/remote-mcp";

/** Saved header values never enter the renderer; blank fields preserve them. */
export function AgentRemoteMcpEditor({ agent, disabled, onSaved }: {
  agent: ComposeAgent; disabled?: boolean; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const label = (key: string) => t(`settings.agentCompose.remoteMcp.${key}`);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AgentRemoteMcp | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const binding = { nodeId: agent.nodeId, projectId: agent.projectId, agentName: agent.agentName };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setConfig(null); setError(""); setLoading(true);
    void window.electronAPI.agentCompose({ action: "getAgentRemoteMcp", binding: {
      nodeId: agent.nodeId, projectId: agent.projectId, agentName: agent.agentName,
    }}).then((result) => {
      if (active) {
        if (!result.mcp) throw new Error(t("settings.agentCompose.remoteMcp.loadError"));
        setConfig({ ...result.mcp, servers: result.mcp.servers.map((s) => ({ ...s,
          headers: s.headers.map((h) => ({ ...h, originalName: h.originalName ?? h.name })),
        })) });
      }
    }).catch(() => { if (active) setError(t("settings.agentCompose.remoteMcp.loadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, agent.nodeId, agent.projectId, agent.agentName, t]);

  const update = (index: number, patch: Partial<RemoteMcpServer>) => setConfig((c) => c && ({
    ...c, servers: c.servers.map((s, i) => i === index ? { ...s, ...patch } : s),
  }));
  const close = () => { setOpen(false); setConfig(null); setError(""); };
  const save = async () => {
    if (!config || saving) return;
    setSaving(true); setError("");
    try {
      await window.electronAPI.agentCompose({ action: "saveAgentRemoteMcp", binding,
        specHash: config.specHash, servers: config.servers });
      close(); onSaved();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(message.includes("mcp_secret_value_required") ? label("reenterSecret") : message || label("saveError"));
    } finally { setSaving(false); }
  };
  return <>
    <Button variant="ghost" size="sm" disabled={disabled} aria-label={`${label("title")} · ${agent.name}`}
      onClick={() => setOpen(true)}>MCP</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!value && !saving) close(); }}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label("title")} · {agent.name}</DialogTitle>
          <DialogDescription>{label("description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {loading && <p className="text-label text-secondary" role="status">{label("loading")}</p>}
          {config && <>
            {config.unmanagedCount > 0 && <p className="text-label-sm text-secondary">{label("unmanaged")}</p>}
            {config.servers.length === 0 && <p className="py-4 text-label text-secondary">{label("empty")}</p>}
            {config.servers.map((server, index) => <fieldset key={index} disabled={saving}
              className="space-y-3 rounded-lg border border-border p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label font-medium">{label("server")} {index + 1}</span>
                <IconButton type="button" aria-label={`${label("removeServer")} ${index + 1}`} icon={<Trash2 className="size-3.5" />}
                  onClick={() => setConfig((c) => c && ({ ...c, servers: c.servers.filter((_, i) => i !== index) }))} />
              </div>
              <label className="block space-y-1 text-label">
                <span>{label("name")}</span>
                <Input aria-label={`${label("name")} ${index + 1}`} placeholder="docs" value={server.name} required
                  pattern="[a-z][a-z0-9_-]*" maxLength={100} onChange={(e) => update(index, { name: e.target.value })} />
              </label>
              <label className="block space-y-1 text-label">
                <span>{label("url")}</span>
                <Input aria-label={`${label("url")} ${index + 1}`} type="url" required placeholder="https://example.com/mcp"
                  value={server.url} onChange={(e) => update(index, { url: e.target.value })} />
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label">{label("headers")}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => update(index, {
                    headers: [...server.headers, { name: "", value: "" }],
                  })}><Plus className="size-3.5" />{label("addHeader")}</Button>
                </div>
                {server.headers.map((header, headerIndex) => <div key={headerIndex} className="flex items-center gap-2">
                  <Input aria-label={`${label("headerName")} ${index + 1}.${headerIndex + 1}`} className="w-[40%]"
                    placeholder="Authorization" value={header.name} required autoComplete="off"
                    onChange={(e) => update(index, { headers: server.headers.map((h, i) => i === headerIndex ? { ...h, name: e.target.value } : h) })} />
                  <Input aria-label={`${label("headerValue")} ${index + 1}.${headerIndex + 1}`} type="password"
                    autoComplete="new-password" spellCheck={false} value={header.value ?? ""}
                    placeholder={header.hasValue && server.name === server.originalName && header.name === header.originalName ? label("keepValue") : "Bearer …"}
                    required={!(header.hasValue && server.name === server.originalName && header.name === header.originalName)}
                    onChange={(e) => update(index, { headers: server.headers.map((h, i) => i === headerIndex
                      ? { ...h, value: e.target.value || (h.hasValue ? undefined : "") } : h) })} />
                  <IconButton type="button" aria-label={`${label("removeHeader")} ${index + 1}.${headerIndex + 1}`} icon={<Trash2 className="size-3.5" />}
                    onClick={() => update(index, { headers: server.headers.filter((_, i) => i !== headerIndex) })} />
                </div>)}
              </div>
              {server.headers.some((h) => h.hasValue && (server.name !== server.originalName || h.name !== h.originalName)) &&
                <p role="status" className="text-label-sm text-secondary">{label("reenterSecret")}</p>}
            </fieldset>)}
            <Button type="button" variant="outline" size="sm" disabled={saving || config.servers.length >= 50}
              onClick={() => setConfig((c) => c && ({ ...c, servers: [...c.servers, { name: "", url: "", headers: [] }] }))}>
              <Plus className="size-3.5" />{label("addServer")}
            </Button>
            <p className="text-label-sm text-tertiary">{label("runtimeNotice")}</p>
          </>}
          {error && <p role="alert" className="text-label text-destructive whitespace-pre-wrap">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={close}>{t("settings.agentCompose.cancel")}</Button>
            <Button type="submit" disabled={loading || saving || !config}>{saving ? label("saving") : t("settings.agentCompose.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
