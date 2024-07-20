"use client";

import { Button, Input } from "@/components/ui";
import { getDictionary } from "@/dictionaries";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import logger from "@/utils/logger";

export default function LoginForm({
  dict,
}: Readonly<{
  dict: Awaited<ReturnType<typeof getDictionary>>;
}>) {
  const [data, setData] = useState({ email: "", password: "" });
  const [errorMessage, setErrorMessage] = useState("");

  const [isPending, startTransition] = useTransition();

  const router = useRouter();

  const handleChange = ({
    target: { name, value },
  }: React.ChangeEvent<HTMLInputElement>) => {
    setData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      setErrorMessage("");

      const response = await signIn("credentials", {
        ...data,
        callbackUrl: location.origin,
        redirect: false,
      });

      if (response?.error) {
        logger.error(response.error);

        setErrorMessage(response.error);
      } else {
        router.replace("/");
      }
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

      <Input
        autoComplete="email"
        label={dict.user.email}
        name="email"
        onChange={handleChange}
        required
        type="email"
        value={data.email}
      />

      <p className="!-mb-10 text-right">
        <Link href="/forgot-password">{dict.loginForm.forgotPassword}</Link>
      </p>

      <Input
        autoComplete="current-password"
        label={dict.user.password}
        name="password"
        onChange={handleChange}
        required
        type="password"
        value={data.password}
      />

      <Button className="!mt-6 w-full" loading={isPending} type="submit">
        {dict.loginForm.submit}
      </Button>
    </form>
  );
}
