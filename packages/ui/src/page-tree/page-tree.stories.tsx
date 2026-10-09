import type { Meta, StoryObj } from "@storybook/react";
import { PageTree } from "./page-tree";
const meta: Meta<typeof PageTree> = {
  title: "Pages/Document tree",
  component: PageTree,
  args: {
    folders: [
      { id: "engineering", project: "demo", parent: null, name: "Разработка", sort_order: 1 },
      { id: "architecture", project: "demo", parent: "engineering", name: "Архитектура", sort_order: 2 },
      { id: "team", project: "demo", parent: null, name: "Команда", sort_order: 3 },
    ],
    documents: [
      { id: "auth", name: "Авторизация", folderId: "architecture" },
      { id: "onboarding", name: "Онбординг", folderId: "team" },
      { id: "notes", name: "Заметки", folderId: null },
    ],
    labels: {
      navigation: "Документы",
      all: "Все документы",
      root: "Без папки",
      expand: "Развернуть",
      collapse: "Свернуть",
    },
    onSelectFolder: () => {},
    onSelectPage: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-64 bg-surface-1 p-3 text-primary">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof PageTree>;
export const Default: Story = {};
export const NestedDocument: Story = { args: { selectedPage: "auth" } };
export const Empty: Story = { args: { folders: [], documents: [] } };
