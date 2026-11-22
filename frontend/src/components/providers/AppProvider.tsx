"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiFetch, getStoredToken } from "@/lib/api";
import type { UserProfile, Workspace } from "@/lib/types";

interface AppContextValue {
  user: UserProfile | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  loading: boolean;
  setActiveWorkspaceId: (id: string) => void;
  refreshSession: () => Promise<void>;
  logout: () => void;
}

const AppContext = createContext<AppContextValue>({
  user: null,
  workspaces: [],
  activeWorkspace: null,
  loading: true,
  setActiveWorkspaceId: () => {},
  refreshSession: async () => {},
  logout: () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWsIdState] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveWsIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("pygrader_workspace_id", id);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ user: UserProfile; workspaces: Workspace[] }>("/auth/me", {
        skipWorkspace: true,
      });
      setUser(data.user);
      setWorkspaces(data.workspaces);
      const saved = typeof window !== "undefined" ? localStorage.getItem("pygrader_workspace_id") : "";
      const valid = data.workspaces.find((w) => w.id === saved) || data.workspaces[0];
      if (valid) {
        setActiveWorkspaceId(valid.id);
      }
    } catch {
      setUser(null);
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, [setActiveWorkspaceId]);

  const logout = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("pygrader_token");
      localStorage.removeItem("pygrader_workspace_id");
    }
    setUser(null);
    setWorkspaces([]);
    setActiveWsIdState("");
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;

  return (
    <AppContext.Provider
      value={{
        user,
        workspaces,
        activeWorkspace,
        loading,
        setActiveWorkspaceId,
        refreshSession,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
