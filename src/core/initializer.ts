import fs from "node:fs/promises";
import path from "node:path";
import { getTrackerRoot } from "../storage/file-store.js";

export interface InitResult {
  root: string;
  created: string[];
  skipped: string[];
}

const EXAMPLES: Record<string, string> = {
  "config.yaml": `server:
  baseUrl: "http://localhost:8080"

openapi:
  specPath: "./openapi.yaml"

auth:
  profiles:
    user:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "user@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"
      note: "일반 사용자"
    admin:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "admin@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"
      note: "관리자"

db:
  resetCommand: "echo reset"
  resetWorkingDir: "."
`,
  "openapi.yaml": `openapi: 3.0.0
info:
  title: Example API
  version: 0.1.0
paths:
  /auth/login:
    post:
      operationId: login
      requestBody:
        required: true
      responses:
        "200":
          description: login success

  /projects:
    get:
      operationId: listProjects
      responses:
        "200":
          description: project list
    post:
      operationId: createProject
      requestBody:
        required: true
      responses:
        "201":
          description: created project

  /projects/{projectId}:
    get:
      operationId: getProject
      parameters:
        - name: projectId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: project detail
    patch:
      operationId: updateProject
      parameters:
        - name: projectId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
      responses:
        "200":
          description: updated project

  /projects/{projectId}/logs:
    get:
      operationId: listProjectLogs
      parameters:
        - name: projectId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: project logs
`,
  "flow.yaml": `version: 1

# Default start screen. Override per session with:
# api-tracker flow start --session qa-flow --state login
initialState: login
defaultAuth: user

states:
  login:
    route: /login
    actions:
      login_success:
        to: project_list
        calls:
          - id: login
            operationId: login
            auth: ""
            body:
              email: "\${env.QA_EMAIL}"
              password: "\${env.QA_PASSWORD}"
            save:
              token: $.body.accessToken
            expect:
              status: 200

      login_failure:
        to: login
        manual:
          - email
          - password
        calls:
          - id: login
            operationId: login
            auth: ""
            body:
              email: "\${manual.email}"
              password: "\${manual.password}"
            expect:
              status: 401

  project_list:
    route: /projects
    actions:
      load_projects:
        to: project_list
        calls:
          - id: listProjects
            operationId: listProjects
            expect:
              status: 200
            observe:
              project:
                id: $.body.projects[*].id
                label: $.body.projects[*].name

      open_project_detail:
        to: project_detail
        requires:
          project:
            observedAs: project
        calls:
          - id: getProject
            operationId: getProject
            params:
              projectId: "\${project.id}"
            expect:
              status: 200

      create_project:
        to: project_detail
        manual:
          - name
          - visibility
        calls:
          - id: createProject
            operationId: createProject
            body:
              name: "\${manual.name}"
              visibility: "\${manual.visibility}"
            expect:
              status: 201
            observe:
              project:
                id: $.body.id
                label: $.body.name

  project_detail:
    route: /projects/:projectId
    actions:
      update_project:
        to: project_detail
        requires:
          project:
            observedAs: project
        manual:
          - patch
        calls:
          - id: updateProject
            operationId: updateProject
            params:
              projectId: "\${project.id}"
            body: "\${manual.patch}"
            expect:
              status: 200
            observe:
              project:
                id: $.body.id
                label: $.body.name

      load_project_logs:
        to: project_detail
        requires:
          project:
            observedAs: project
        calls:
          - id: listProjectLogs
            operationId: listProjectLogs
            params:
              projectId: "\${project.id}"
            expect:
              status: 200

      back_to_list:
        to: project_list
        calls: []
`,
};

export async function initProject(options?: { force?: boolean }): Promise<InitResult> {
  const root = getTrackerRoot();
  await fs.mkdir(root, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  for (const [fileName, contents] of Object.entries(EXAMPLES)) {
    const filePath = path.join(root, fileName);
    const exists = await pathExists(filePath);
    if (exists && !options?.force) {
      skipped.push(fileName);
      continue;
    }
    await fs.writeFile(filePath, contents, "utf-8");
    created.push(fileName);
  }

  return { root, created, skipped };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
