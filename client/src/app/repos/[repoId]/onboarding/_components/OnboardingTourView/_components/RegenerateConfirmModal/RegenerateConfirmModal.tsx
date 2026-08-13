"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";

/**
 * Regenerate confirmation (D-14, AC-6, E-13, UX-3) — names BOTH
 * consequences before any request is issued: one paid model call, and the
 * tour every workspace member sees is replaced. The generate request must
 * NOT be issued until this is accepted (component test).
 */
export function RegenerateConfirmModal({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("onboarding");
  return (
    <Modal
      title={t("confirm.title")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="secondary" onClick={onClose}>
            {t("confirm.cancelCta")}
          </Button>
          <Button kind="primary" onClick={onConfirm}>
            {t("confirm.confirmCta")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>{t("confirm.body")}</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{t("confirm.outboundNotice")}</p>
      </div>
    </Modal>
  );
}
