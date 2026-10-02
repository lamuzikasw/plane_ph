import { Navigate, useParams } from "react-router";
import useSWR from "swr";
import { Spinner } from "@plane/ui";
import { Button } from "@plane/propel/button";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { boardLinkKey, boardLinkService } from "@/services/board-link.service";

function BoardLinkRedirect() {
  const { token } = useParams();
  const { data, error, mutate } = useSWR(token ? boardLinkKey(token) : null, () => boardLinkService.retrieve(token!), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  if (error)
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p role="alert">Ссылка недоступна. Проверьте доступ к проекту.</p>
        <Button onClick={() => void mutate()}>Повторить</Button>
      </div>
    );
  if (!data)
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  return <Navigate replace to={`${data.path}?share=${data.token}`} />;
}

export default function SharedBoardPage() {
  return (
    <AuthenticationWrapper>
      <BoardLinkRedirect />
    </AuthenticationWrapper>
  );
}
