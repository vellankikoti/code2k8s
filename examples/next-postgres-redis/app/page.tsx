import Dashboard from "./dashboard";
import { podName } from "../lib/clients";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Dashboard initialPod={podName} />;
}
