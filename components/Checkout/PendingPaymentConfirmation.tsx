"use client";

import { useRouter } from "next/navigation";
import { BoletoPaymentResult } from "./BoletoPaymentResult";
import { PixPaymentResult } from "./PixPaymentResult";
import type {
  BoletoPaymentResult as BoletoPaymentResultData,
  PixPaymentResult as PixPaymentResultData,
} from "@/types/payments";

interface PendingPaymentConfirmationProps {
  result: PixPaymentResultData | BoletoPaymentResultData;
}

export function PendingPaymentConfirmation({ result }: PendingPaymentConfirmationProps) {
  const router = useRouter();
  const refreshPaidStatus = () => router.refresh();

  if (result.method === "inter_pix") {
    return (
      <PixPaymentResult
        result={result}
        onPaid={refreshPaidStatus}
        onExpired={refreshPaidStatus}
      />
    );
  }

  return <BoletoPaymentResult result={result} onPaid={refreshPaidStatus} />;
}
