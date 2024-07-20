"use client";

import { Button, Input } from "@/components/ui";
import { getDictionary } from "@/dictionaries";
import { resetPassword } from "./actions";
import { useActionState, useState } from "react";

export default function ResetPasswordForm({
  dict,
  token,
}: Readonly<{
  dict: Awaited<ReturnType<typeof getDictionary>>;
  token: string;
}>) {
  const [data, setData] = useState({
    password: "",
    confirmPassword: "",
  });

  const [state, formAction, pending] = useActionState(resetPassword, null);

  const handleChange = ({
    target: { name, value },
  }: React.ChangeEvent<HTMLInputElement>) => {
    setData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <form action={formAction} className="space-y-4">
      {state?.errorMessage && (
        <div className="alert alert-danger">{state.errorMessage}</div>
      )}

      <input type="hidden" name="token" value={token} />

      <Input
        autoComplete="new-password"
        error={state?.errors?.password}
        label={dict.user.password}
        name="password"
        onChange={handleChange}
        required
        type="password"
        value={data.password}
      />

      <Input
        autoComplete="new-password"
        error={state?.errors?.confirmPassword}
        label={dict.user.confirmPassword}
        name="confirmPassword"
        onChange={handleChange}
        required
        type="password"
        value={data.confirmPassword}
      />

      <Button className="!mt-6 w-full" loading={pending} type="submit">
        {dict.form.submit}
      </Button>
    </form>
  );
}
