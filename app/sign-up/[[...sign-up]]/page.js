import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="card">
      <h1>הרשמה</h1>
      <SignUp />
    </div>
  );
}

