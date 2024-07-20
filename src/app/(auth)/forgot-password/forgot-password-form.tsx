"use client";

import { Button, Input } from "@/components/ui";
import { forgotPassword } from "./actions";
import { getDictionary } from "@/dictionaries";
import { useActionState, useState } from "react";

export default function ForgotPasswordForm({
  dict,
}: Readonly<{
  dict: Awaited<ReturnType<typeof getDictionary>>;
}>) {
  const [data, setData] = useState({
    email: "",
  });

  const [state, formAction, pending] = useActionState(forgotPassword, null);

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

      <Input
        autoComplete="email"
        error={state?.errors?.email}
        label={dict.user.email}
        name="email"
        onChange={handleChange}
        required
        type="email"
        value={data.email}
      />

      <Button className="!mt-6 w-full" loading={pending} type="submit">
        {dict.forgotPasswordForm.submit}
      </Button>
    </form>
  );
}
