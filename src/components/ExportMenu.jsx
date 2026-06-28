import { useState, useRef, useEffect } from "react";

export default function ExportMenu({
  onShareServer,
  onShareClient,
  serverStatus,
  clientStatus,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const serverLabel =
    serverStatus === "copying"
      ? "Saving…"
      : serverStatus === "copied"
        ? "Copied!"
        : serverStatus === "error"
          ? "Failed"
          : "Copy short link";

  const clientLabel =
    clientStatus === "copied"
      ? "Copied!"
      : clientStatus === "error"
        ? "Failed"
        : "Copy instant link";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className="wow-btn px-4 py-2 text-xs rounded select-none flex items-center gap-1.5"
      >
        <span>Export / Share</span>
        <span className="text-[10px] opacity-70">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-full mb-2 w-72 wow-panel p-1.5 rounded shadow-xl border border-[#3a2e1a] z-50 flex flex-col gap-1 text-left">
          <button
            type="button"
            onClick={onShareServer}
            disabled={serverStatus !== "idle"}
            className="w-full p-2.5 rounded hover:bg-[#251b0d] transition-colors flex flex-col items-start gap-1 select-none text-left border border-transparent hover:border-[#3a2e1a]/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              className="text-xs font-semibold tracking-wider uppercase"
              style={
                serverStatus === "copied"
                  ? { color: "#4ade80" }
                  : serverStatus === "error"
                    ? { color: "#f87171" }
                    : { color: "#c8a84b" }
              }
            >
              {serverLabel}
            </span>
            <span className="text-[11px] text-wow-muted leading-normal font-normal normal-case tracking-normal">
              Best for Discord / Reddit (creates a clean ?id=... link)
            </span>
          </button>

          <div className="h-[1px] bg-[#3a2e1a]/50 my-0.5 mx-2" />

          <button
            type="button"
            onClick={onShareClient}
            disabled={clientStatus !== "idle"}
            className="w-full p-2.5 rounded hover:bg-[#251b0d] transition-colors flex flex-col items-start gap-1 select-none text-left border border-transparent hover:border-[#3a2e1a]/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              className="text-xs font-semibold tracking-wider uppercase"
              style={
                clientStatus === "copied"
                  ? { color: "#4ade80" }
                  : clientStatus === "error"
                    ? { color: "#f87171" }
                    : { color: "#c8a84b" }
              }
            >
              {clientLabel}
            </span>
            <span className="text-[11px] text-wow-muted leading-normal font-normal normal-case tracking-normal">
              Standalone URL with zero server dependency
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
