import { redirect } from "next/navigation";

// This route only redirects, so it has no instant UI to validate.
export const instant = false;

export default function Home() {
  redirect("/dashboard");
}
