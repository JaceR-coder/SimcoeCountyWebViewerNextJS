"use client";

/**
 * Header profile button for config.authProvider === "pygeomatics": log in / out of py-Geomatics
 * (served same-origin through the /geomatics rewrite) instead of NextAuth / Azure AD.
 */

import { useState, useRef, useEffect } from "react";
import { FaSignInAlt, FaSignOutAlt, FaSpinner } from "react-icons/fa";
import ThemeToggle from "@/components/ThemeToggle";
import { useImapAuthStore } from "@/stores/imapAuthStore";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

const buttonClass = "w-[60px] text-center flex flex-col items-center justify-center cursor-pointer px-1 text-xs text-neutral h-[52px] hover:bg-black/5 dark:hover:bg-white/5";

export default function GeomaticsProfileButton() {
  const status = useImapAuthStore((s) => s.status);
  const userDisplayName = useImapAuthStore((s) => s.userDisplayName);
  const allLayers = useImapAuthStore((s) => s.allLayers);
  const grantedCount = useImapAuthStore((s) => s.grantedLayers.size);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsDropdownOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsDropdownOpen(false);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const handleSignIn = () => {
    window.location.href = useImapAuthStore.getState().loginUrl();
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await useImapAuthStore.getState().logout();
    setSigningOut(false);
    setIsDropdownOpen(false);
  };

  if (status === "idle" || status === "loading" || signingOut) {
    return (
      <div className="w-[60px] text-center flex flex-col items-center justify-center px-1 text-xs text-neutral h-[52px]" title="Loading...">
        <FaSpinner size={16} className="mt-1 mb-1 animate-spin" />
        <span>Loading</span>
      </div>
    );
  }

  if (!userDisplayName) {
    return (
      <div
        className={buttonClass}
        onClick={handleSignIn}
        title={status === "error" ? "py-Geomatics is unreachable - public layers only" : "Sign in with your pyGeomatics account"}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
      >
        <FaSignInAlt size={16} className="mt-1 mb-1" />
        <span>Sign In</span>
      </div>
    );
  }

  const userInitial = userDisplayName.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        className={buttonClass}
        onClick={() => setIsDropdownOpen((o) => !o)}
        title={userDisplayName}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setIsDropdownOpen((o) => !o)}
        aria-expanded={isDropdownOpen}
        aria-haspopup="true"
      >
        <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium mt-1 mb-0.5">{userInitial}</div>
        <span className="truncate max-w-[58px]">Profile</span>
      </div>

      {isDropdownOpen && (
        <div className="animate-dropdownFadeIn absolute right-0 top-[52px] bg-base-100 border border-base-300 shadow-lg rounded-b-md min-w-[220px] z-50 max-h-[calc(100vh-60px)] overflow-y-auto">
          <div className="px-4 py-3 border-b border-base-300">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center text-lg font-medium">{userInitial}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-base-content truncate">{userDisplayName}</p>
                <p className="text-xs text-base-content/60 truncate">pyGeomatics account</p>
              </div>
            </div>
          </div>

          <div className="px-4 py-2 border-b border-base-300">
            <p className="text-xs text-base-content/60">Layer access:</p>
            <p className="text-xs text-base-content">{allLayers ? "All layers" : `${grantedCount.toLocaleString()} layers`}</p>
          </div>

          <ThemeToggle />

          <div className="px-2 py-2">
            <button onClick={handleSignOut} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-base-content hover:bg-base-200 rounded transition-colors">
              <FaSignOutAlt size={14} />
              <span>Sign Out</span>
            </button>
          </div>

          <div className="px-4 py-2 border-t border-base-300">
            <p className="text-xs text-base-content/70 text-center">Version {APP_VERSION}</p>
          </div>
        </div>
      )}
    </div>
  );
}
