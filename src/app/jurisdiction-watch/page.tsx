import { redirect } from "next/navigation";

// Jurisdiction Watch now ships as the standalone faraday-jurisdiction-watch app on
// its own domain (jurisdiction-watch.com). Redirect the legacy in-engine path there so
// direct/deep links land on the real product (supersedes the earlier stub).
export default function Page() {
  redirect("https://jurisdiction-watch.com");
}
