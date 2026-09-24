/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useForm, Controller } from "react-hook-form";
// plane imports
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { FileService } from "@/services/file.service";
import { CommentReplyContext } from "./comment-reply-context";

type TCommentCreate = {
  entityId: string;
  workspaceSlug: string;
  activityOperations: TCommentsOperations;
  showToolbarInitially?: boolean;
  projectId?: string;
  onSubmitCallback?: (elementId: string) => void;
  parentComment?: TIssueComment;
  replyToComment?: TIssueComment;
  onCancel?: () => void;
};

// services
const fileService = new FileService();

export const CommentCreate = observer(function CommentCreate(props: TCommentCreate) {
  const {
    workspaceSlug,
    entityId,
    activityOperations,
    showToolbarInitially = false,
    projectId,
    onSubmitCallback,
    parentComment,
    replyToComment,
    onCancel,
  } = props;
  const { t } = useTranslation();
  // states
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const submittingRef = useRef(false);
  const replyContextRef = useRef<HTMLDivElement>(null);
  const replyTarget = replyToComment ?? parentComment;

  // Selecting another message in the same thread preserves the current draft.
  useEffect(() => {
    if (!replyTarget?.id) return;
    replyContextRef.current?.scrollIntoView({ block: "nearest" });
    editorRef.current?.focus("end");
  }, [replyTarget?.id]);
  // store hooks
  const workspaceStore = useWorkspace();
  // derived values
  const workspaceId = workspaceStore.getWorkspaceBySlug(workspaceSlug)?.id as string;
  // form info
  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
    reset,
  } = useForm<Partial<TIssueComment>>({
    defaultValues: {
      comment_html: "<p></p>",
    },
  });

  const onSubmit = async (formData: Partial<TIssueComment>) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const comment = await activityOperations.createComment({
        ...formData,
        ...(parentComment ? { parent: parentComment.id, access: parentComment.access } : {}),
      });
      // The operations layer reports errors with a toast and can return undefined.
      if (!comment?.id) return;
      try {
        if (uploadedAssetIds.length > 0) {
          if (projectId) {
            await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId.toString(), entityId, {
              asset_ids: uploadedAssetIds,
            });
          } else {
            await fileService.updateBulkWorkspaceAssetsUploadStatus(workspaceSlug, entityId, {
              asset_ids: uploadedAssetIds,
            });
          }
        }
      } finally {
        // The message is persisted even if attachment bookkeeping fails; don't
        // leave it in the composer where retrying would create a duplicate.
        setUploadedAssetIds([]);
        reset({ comment_html: "<p></p>" });
        editorRef.current?.clearEditor();
        onSubmitCallback?.(comment.id);
      }
    } catch (error) {
      console.error(error);
    } finally {
      submittingRef.current = false;
    }
  };

  const commentHTML = watch("comment_html");
  const isEmpty = isCommentEmpty(commentHTML ?? undefined);

  return (
    <div
      role="group"
      aria-label={parentComment ? t("issue.comments.replies.create.placeholder") : t("issue.comments.placeholder")}
      className={cn("bg-surface-1", !parentComment && "sticky bottom-0 z-[4] sm:static")}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !isEmpty &&
          !isSubmitting &&
          editorRef.current?.isEditorReadyToDiscard()
        )
          handleSubmit(onSubmit)(e);
      }}
    >
      {parentComment && replyTarget && (
        <div ref={replyContextRef} className="mb-2">
          <CommentReplyContext comment={replyTarget} />
        </div>
      )}
      <Controller
        name="access"
        control={control}
        render={({ field: { onChange: onAccessChange, value: accessValue } }) => (
          <Controller
            name="comment_html"
            control={control}
            render={({ field: { value, onChange } }) => (
              <LiteTextEditor
                editable
                workspaceId={workspaceId}
                id={`add_comment_${parentComment?.id ?? entityId}`}
                autofocus={!!parentComment}
                placeholder={parentComment ? t("issue.comments.replies.create.placeholder") : undefined}
                submitButtonText={parentComment ? "common.actions.reply" : "common.comment"}
                value={"<p></p>"}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                onEnterKeyPress={(e) => {
                  if (!isEmpty && !isSubmitting) {
                    handleSubmit(onSubmit)(e);
                  }
                }}
                ref={editorRef}
                initialValue={value ?? "<p></p>"}
                containerClassName="min-h-min"
                onChange={(comment_json, comment_html) => onChange(comment_html)}
                accessSpecifier={parentComment?.access ?? accessValue ?? EIssueCommentAccessSpecifier.INTERNAL}
                handleAccessChange={parentComment ? undefined : onAccessChange}
                isSubmitting={isSubmitting}
                uploadFile={async (blockId, file) => {
                  const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file);
                  setUploadedAssetIds((prev) => [...prev, asset_id]);
                  return asset_id;
                }}
                duplicateFile={async (assetId: string) => {
                  const { asset_id } = await activityOperations.duplicateCommentAsset(assetId);
                  setUploadedAssetIds((prev) => [...prev, asset_id]);
                  return asset_id;
                }}
                showToolbarInitially={showToolbarInitially}
                parentClassName="p-2"
                displayConfig={{
                  fontSize: "small-font",
                }}
              />
            )}
          />
        )}
      />
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="mt-2 rounded px-2 py-1 text-body-sm-regular text-secondary hover:bg-layer-1 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
      )}
    </div>
  );
});
