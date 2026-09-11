import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function PlatinaRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <div className="min-h-screen bg-background text-foreground">{children}</div>
  );
}
