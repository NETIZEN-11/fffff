"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Key, Plus, Trash2, Copy, Check, Loader2,
  ShieldCheck, Clock, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { apiFetch } from "@/shared/hooks/use-api";
import { formatDate } from "@/lib/utils";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  isActive: boolean;
};

type NewKeyResult = {
  id: string;
  name: string;
  prefix: string;
  key: string;
  expiresAt: string | null;
  createdAt: string;
};

const EXPIRY_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "1y", label: "1 year" },
  { value: "never", label: "No expiry" },
];

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function KeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: ApiKey;
  onRevoke: (id: string, name: string) => void;
}) {
  const expired = isExpired(apiKey.expiresAt);

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${expired ? "bg-red-500/10" : "bg-primary/10"}`}>
          <Key className={`h-4 w-4 ${expired ? "text-red-500" : "text-primary"}`} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{apiKey.name}</p>
            {expired && (
              <Badge variant="destructive" className="text-xs py-0">Expired</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
              {apiKey.prefix}_••••••••
            </code>
            {apiKey.expiresAt && !expired && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Expires {formatDate(apiKey.expiresAt)}
              </span>
            )}
            {!apiKey.expiresAt && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />
                No expiry
              </span>
            )}
            {apiKey.lastUsedAt && (
              <span className="text-xs text-muted-foreground">
                Last used {formatDate(apiKey.lastUsedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 hover:text-destructive ml-2"
        onClick={() => onRevoke(apiKey.id, apiKey.name)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function ApiKeysPanel() {
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [expiresIn, setExpiresIn] = useState("never");
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiFetch<ApiKey[]>("/api/v1/api-keys"),
  });

  const keys = data?.data ?? [];

  async function createKey() {
    if (!newKeyName.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch<NewKeyResult>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName.trim(), expiresIn }),
      });
      if (res.data) {
        setNewKey(res.data);
        setCreateOpen(false);
        setNewKeyName("");
        setExpiresIn("never");
        queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setSaving(false);
    }
  }

  async function revokeKey(id: string, name: string) {
    setRevokingId(id);
    try {
      await apiFetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
      toast.success(`"${name}" revoked`);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke key");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                <CardTitle>API Keys</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Use API keys to authenticate requests from your own tools and scripts.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={keys.length >= 10}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Key
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Warning about key security */}
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              API keys grant full access to your account. Keep them secret — treat them like passwords.
              Never commit them to source control.
            </p>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
              <Key className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">
                No API keys yet. Create one to get started.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden divide-y">
              {keys.map((key) => (
                <div key={key.id} className="relative">
                  {revokingId === key.id && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  )}
                  <KeyRow apiKey={key} onRevoke={revokeKey} />
                </div>
              ))}
            </div>
          )}

          {keys.length >= 10 && (
            <p className="text-xs text-muted-foreground text-center">
              Maximum of 10 active API keys reached. Revoke some to create new ones.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Give your key a descriptive name so you remember what it&apos;s for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                placeholder='e.g. "CI Pipeline" or "Personal Script"'
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && createKey()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-expiry">Expiry</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger id="key-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createKey} disabled={saving || !newKeyName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Key Reveal Dialog — shown ONCE after creation */}
      <Dialog
        open={!!newKey}
        onOpenChange={(open) => {
          if (!open) setNewKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-500" />
              API Key Created
            </DialogTitle>
            <DialogDescription>
              Copy your key now. For security, it will{" "}
              <strong>not be shown again</strong> after you close this dialog.
            </DialogDescription>
          </DialogHeader>

          {newKey && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Your API Key</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg border bg-muted px-3 py-2.5 text-xs font-mono break-all select-all">
                    {newKey.key}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copyKey(newKey.key)}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  <strong>Store this key securely.</strong> Once you close this dialog,
                  you will not be able to see it again. If you lose it, you will need to
                  create a new key.
                </p>
              </div>

              {newKey.expiresAt && (
                <p className="text-xs text-muted-foreground">
                  This key expires on{" "}
                  <strong>{formatDate(newKey.expiresAt)}</strong>.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => newKey && copyKey(newKey.key)}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1.5 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1.5" />
                  Copy Key
                </>
              )}
            </Button>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
