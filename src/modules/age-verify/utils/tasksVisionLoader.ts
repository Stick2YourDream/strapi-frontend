type TasksVisionModule = typeof import("@mediapipe/tasks-vision");

let tasksVisionPromise: Promise<TasksVisionModule> | null = null;

export const loadTasksVision = async (): Promise<TasksVisionModule> => {
  if (!tasksVisionPromise) {
    tasksVisionPromise = import("@mediapipe/tasks-vision");
  }
  return tasksVisionPromise;
};

export const resetTasksVisionLoader = () => {
  tasksVisionPromise = null;
};

