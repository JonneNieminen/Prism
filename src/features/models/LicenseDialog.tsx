import { AlertTriangle, ExternalLink, Scale } from "lucide-react";
import type { ModelInfo } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/ui";
import { backend } from "../../lib/ipc";

/** Shown before a model's first use. Non-commercial licenses are flagged. */
export function LicenseDialog({
  model,
  onClose,
  onAccept,
}: {
  model: ModelInfo | null;
  onClose: () => void;
  onAccept: (m: ModelInfo) => void;
}) {
  const m = model?.manifest;
  return (
    <Modal open={!!model} onClose={onClose} title="Before you use this model">
      {m && (
        <div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-elevated/50 p-3.5">
            <Scale size={20} className="mt-0.5 shrink-0 text-muted" />
            <div className="text-sm">
              <div className="font-medium">{m.name}</div>
              <div className="mt-1 text-muted">
                by {m.author} · License: <span className="text-text">{m.license}</span>
              </div>
              {m.licenseUrl && (
                <button className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline" data-tip={m.licenseUrl} onClick={() => void backend().then((b) => b.openUrl(m.licenseUrl!))}>
                  Read the license <ExternalLink size={11} />
                </button>
              )}
            </div>
          </div>
          {model!.nonCommercial && (
            <div className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-elevated/50 p-3.5 text-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <div className="font-medium">Non-commercial license</div>
                <div className="mt-0.5 text-muted">Stems made with this model may not be used commercially.</div>
              </div>
            </div>
          )}
          <p className="mt-4 text-[13px] text-muted">
            Prism runs the model locally. The model's author sets the terms for how its output can be used.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} shortcut="closeDialog" tip="Don't use this model">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => onAccept(model!)} data-autofocus tip="Accept the license and start separating">
              I understand, continue
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
