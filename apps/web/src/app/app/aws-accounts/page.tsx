import type { Metadata } from "next";
import { AwsAccountsView } from "./AwsAccountsView";

export const metadata: Metadata = { title: "AWS Accounts" };

export default function AwsAccountsPage() {
  return <AwsAccountsView />;
}
