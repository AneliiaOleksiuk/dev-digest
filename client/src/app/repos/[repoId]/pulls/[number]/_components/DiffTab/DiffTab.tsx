"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { FocusFindingsOptions } from "@/lib/types";
import type { PrFile, FindingRecord } from "@devdigest/shared";
import { SmartDiffViewer, SplitSuggestionBanner, smartDiffStyles as sd } from "../SmartDiffViewer";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** All of this PR's findings — matched to diff lines by file + line range. */
  findings: FindingRecord[];
  /** Deep-links a severity/finding into the Findings tab (shared with FindingsTab). */
  onFocusFindings: (opts: FocusFindingsOptions) => void;
}

type OrderMode = "smart" | "original";

export function DiffTab({ prId, filesCount, files, canComment, findings, onFocusFindings }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const smartDiffQuery = useSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const [order, setOrder] = React.useState<OrderMode>("smart");

  const commentCount = comments?.length ?? 0;
  const smartDiff = smartDiffQuery.data;
  const smartFailed = smartDiffQuery.isError;
  const smartReady = !!smartDiff && !smartFailed;
  const effectiveOrder: OrderMode = smartReady && order === "smart" ? "smart" : "original";

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const showBanner = !!smartDiff?.split_suggestion.too_big;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={sd.headerRight}>
            {smartFailed && <span style={sd.unavailable}>{t("smartDiff.unavailable")}</span>}
            <div style={sd.orderToggle} role="group" aria-label={t("smartDiff.order.label")}>
              <button
                type="button"
                disabled={smartFailed || smartDiffQuery.isLoading}
                onClick={() => setOrder("smart")}
                style={{
                  ...sd.orderBtn,
                  ...(effectiveOrder === "smart" ? sd.orderBtnActive : {}),
                  opacity: smartFailed || smartDiffQuery.isLoading ? 0.5 : 1,
                }}
              >
                {t("smartDiff.order.smart")}
              </button>
              <button
                type="button"
                onClick={() => setOrder("original")}
                style={{
                  ...sd.orderBtn,
                  ...(effectiveOrder === "original" ? sd.orderBtnActive : {}),
                }}
              >
                {t("smartDiff.order.original")}
              </button>
            </div>
            {commentCount > 0 ? (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            ) : undefined}
          </div>
        }
      >
        {t("smartDiff.title")}
        {filesCount > 0 ? ` · ${filesCount}` : ""}
      </SectionLabel>

      {showBanner && smartDiff && (
        <div style={{ marginBottom: 16 }}>
          <SplitSuggestionBanner
            totalLines={smartDiff.split_suggestion.total_lines}
            proposedSplits={smartDiff.split_suggestion.proposed_splits}
          />
        </div>
      )}

      {effectiveOrder === "smart" && smartDiff ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          findings={findings}
          commenting={commenting}
          onFocusFindings={onFocusFindings}
          showSplitBanner={false}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} findings={findings} onFocusFindings={onFocusFindings} />
      )}
    </section>
  );
}
