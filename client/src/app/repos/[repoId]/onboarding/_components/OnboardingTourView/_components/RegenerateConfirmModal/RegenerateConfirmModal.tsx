"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";

/**
 * Generation confirmation (D-14, AC-6, E-13, UX-3, and the fix-loop's
 * FIX-6: the Spec's confirmation requirement is NOT scoped to Regenerate
 * only — "generation happens only on an explicit, confirmed user action,
 * because it costs money" applies just as much to the very first
 * generation). Names BOTH consequences before any request is issued: one
 * paid model call, and — for a REGENERATE — that the tour every workspace
 * member sees is replaced. The generate request must NOT be issued until
 * this is accepted (component test).
 *
 * `mode="generate"` swaps in first-generation copy: "regenerate"/"replaces
 * the tour" reads wrong when there is no existing tour to replace yet.
 */
export function RegenerateConfirmModal({
  onConfirm,
  onClose,
  mode = "regenerate",
}: {
  onConfirm: () => void;
  onClose: () => void;
  mode?: "generate" | "regenerate";
}) {
  const t = useTranslations("onboarding");
  const isFirst = mode === "generate";
  return (
    <Modal
      title={t(isFirst ? "confirm.firstTitle" : "confirm.title")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="secondary" onClick={onClose}>
            {t("confirm.cancelCta")}
          </Button>
          <Button kind="primary" onClick={onConfirm}>
            {t(isFirst ? "confirm.firstConfirmCta" : "confirm.confirmCta")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {t(isFirst ? "confirm.firstBody" : "confirm.body")}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{t("confirm.outboundNotice")}</p>
      </div>
    </Modal>
  );
}
