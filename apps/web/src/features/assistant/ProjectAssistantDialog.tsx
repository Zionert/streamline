import { useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { AssistantChat } from './AssistantChat';
import { useAssistantChat } from './useAssistantChat';

const EMPTY_STATE = {
  title: 'Describe your project',
  description: 'The assistant helps you think through the scope, the roles and the timeline.',
};

export interface ProjectAssistantDialogProps {
  /** Closes the dialog; the session cannot be reopened afterwards. */
  onClose: () => void;
}

/**
 * "New project with assistant": a new board-less conversation with the assistant in a modal,
 * started on every open. Mounted only while open; closing a session that has messages asks
 * first, as there is no list of past conversations to return to.
 */
export default function ProjectAssistantDialog({ onClose }: ProjectAssistantDialogProps) {
  const chat = useAssistantChat({ kind: 'project' });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const { state } = chat;
  const hasConversation =
    state.messages.length > 0 || state.turn !== null || state.failure !== null;

  const requestClose = () => {
    if (hasConversation) {
      setIsConfirmingClose(true);
    } else {
      onClose();
    }
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            requestClose();
          }
        }}
      >
        <DialogContent
          className="flex h-[min(720px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border px-6 pt-5 pb-4 pr-12">
            <DialogTitle>New project with assistant</DialogTitle>
            <DialogDescription>
              Describe the project, the team and the deadline. Creating the board comes in a later
              version.
            </DialogDescription>
          </DialogHeader>
          <AssistantChat
            chat={chat}
            board={null}
            placeholder="Describe your project…"
            emptyState={EMPTY_STATE}
            inputRef={inputRef}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={isConfirmingClose} onOpenChange={setIsConfirmingClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              You won&apos;t be able to come back to it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep chatting</AlertDialogCancel>
            <Button variant="destructive" onClick={onClose}>
              Close conversation
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
