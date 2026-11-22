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
  const [user, setUser] = useState<UserProfile | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("pygrader_user_cache");
      return raw ? (JSON.parse(raw) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("pygrader_workspaces_cache");
      return raw ? (JSON.parse(raw) as Workspace[]) : [];
    } catch {
      return [];
    }
  });
  const [activeWorkspaceId, setActiveWsIdState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("pygrader_workspace_id") || "";
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return !localStorage.getItem("pygrader_user_cache");
  });

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
      if (typeof window !== "undefined") {
        localStorage.setItem("pygrader_user_cache", JSON.stringify(data.user));
        localStorage.setItem("pygrader_workspaces_cache", JSON.stringify(data.workspaces));
      }
      const saved = typeof window !== "undefined" ? localStorage.getItem("pygrader_workspace_id") : "";
      const valid = data.workspaces.find((w) => w.id === saved) || data.workspaces[0];
      if (valid) {
        setActiveWorkspaceId(valid.id);
      }
    } catch {
      setUser(null);
      setWorkspaces([]);
      if (typeof window !== "undefined") {
        localStorage.removeItem("pygrader_user_cache");
        localStorage.removeItem("pygrader_workspaces_cache");
      }
    } finally {
      setLoading(false);
    }
  }, [setActiveWorkspaceId]);

  const logout = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("pygrader_token");
      localStorage.removeItem("pygrader_workspace_id");
      localStorage.removeItem("pygrader_user_cache");
      localStorage.removeItem("pygrader_workspaces_cache");
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
