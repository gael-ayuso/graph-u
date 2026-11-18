"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useRecommendationLibrary } from "@/components/recommendation-library";
import { ExplorationCoordinator } from "@/lib/recommendation-exploration";

const Context = createContext<ExplorationCoordinator | null>(null);
export function RecommendationExplorationProvider({ children }: { children: ReactNode }) {
  const { accountScope } = useRecommendationLibrary();
  return <ExplorationSession key={accountScope} scope={accountScope}>{children}</ExplorationSession>;
}
function ExplorationSession({ scope, children }: { scope: string; children: ReactNode }) {
  const [coordinator] = useState(() => new ExplorationCoordinator(scope));
  useEffect(() => { coordinator.activate(); return coordinator.dispose; }, [coordinator]);
  return <Context.Provider value={coordinator}>{children}</Context.Provider>;
}
export function useRecommendationExploration() {
  const coordinator = useContext(Context);
  if (!coordinator) throw new Error("useRecommendationExploration requires RecommendationExplorationProvider");
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  return { state, start: coordinator.start, expand: coordinator.expand, alternatives: coordinator.alternatives, select: coordinator.select, focus: coordinator.focus, cancel: coordinator.cancel, reset: coordinator.reset };
}
