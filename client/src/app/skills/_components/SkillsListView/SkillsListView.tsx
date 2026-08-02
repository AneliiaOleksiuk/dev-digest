"use client";

import React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { SkillPreview } from "../SkillPreview";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

type DrawerTab = "file" | "url";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [drawerTab, setDrawerTab] = React.useState<DrawerTab | null>(null);

  const selectedId = searchParams.get("skill");
  const list = filterSkills(skills ?? [], search);
  const selected = list.find((skill) => skill.id === selectedId) ?? null;

  const select = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("skill", id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {drawerTab && <ImportSkillDrawer initialTab={drawerTab} onClose={() => setDrawerTab(null)} onImported={select} />}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={240}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setDrawerTab("file") },
              { label: t("page.menu.fromUrl"), icon: "Link", onClick: () => setDrawerTab("url") },
            ]}
          />
        </div>

        <div style={s.body}>
          <div style={s.listCol}>
            {isLoading && (
              <>
                <Skeleton height={90} />
                <Skeleton height={90} />
                <Skeleton height={90} />
              </>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && list.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setDrawerTab("file")}
              />
            )}
            {list.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                active={skill.id === selectedId}
                onClick={() => select(skill.id)}
                onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
              />
            ))}
          </div>
          <div style={s.previewCol}>
            {selected ? (
              <SkillPreview key={selected.id} skill={selected} />
            ) : (
              <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
