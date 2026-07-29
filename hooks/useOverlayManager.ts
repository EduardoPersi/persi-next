"use client";

import {
  useContext,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { OverlayManagerContext } from "@/context/OverlayManager";

interface UseOverlayManagerOptions {
  id: string;
  isOpen: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

export function useOverlayManager({
  id,
  isOpen,
  onClose,
  returnFocusRef,
  closeOnEscape = true,
}: UseOverlayManagerOptions) {
  const manager = useContext(OverlayManagerContext);
  const onCloseRef = useRef(onClose);
  const returnFocusRefRef = useRef(returnFocusRef);

  useEffect(() => {
    onCloseRef.current = onClose;
    returnFocusRefRef.current = returnFocusRef;
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    if (!manager || !isOpen) return;

    const close = () => onCloseRef.current();
    const unregister = manager.register(id, { close });
    manager.activate(id);

    function handleKeyDown(event: KeyboardEvent) {
      if (!closeOnEscape || event.key !== "Escape") return;
      event.preventDefault();
      close();
      window.requestAnimationFrame(() => {
        returnFocusRefRef.current?.current?.focus();
      });
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      manager.deactivate(id);
      unregister();
    };
  }, [closeOnEscape, id, isOpen, manager]);
}
