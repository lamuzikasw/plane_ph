import type { PropsWithChildren } from "react";
import { observer } from "mobx-react";
import { useInstance } from "@/hooks/store/use-instance";

// Do not mount the chat (including its polling effects) unless explicitly enabled.
export const IgorFeature = observer(function IgorFeature({ children }: PropsWithChildren) {
  const { config } = useInstance();
  return config?.is_igor_enabled === true ? <>{children}</> : null;
});
