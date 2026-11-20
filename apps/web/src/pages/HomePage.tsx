import { Icon } from '../canvas/Icons';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { creationTools } from '../components/workspaceTools';
import { useCreateSpace } from '../api/useCreateSpace';
import './HomePage.css';

export function HomePage() {
  const create = useCreateSpace();
  return (
    <WorkspaceLayout
      active="home"
      creating={create.isPending}
      onCreate={(type) => {
        if (!create.isPending) create.mutate(type);
      }}
    >
      <div className="home-content">
        <div className="spaces-heading">
          <div>
            <div className="spaces-breadcrumb">Workspace / Home</div>
            <h1>What would you like to create?</h1>
            <p>Pick a tool and make your next idea happen.</p>
          </div>
        </div>
        {create.error && (
          <p className="page-error" role="alert">
            {create.error.message}
          </p>
        )}
        {create.isPending && (
          <p className="home-status" role="status">
            Preparing your canvas…
          </p>
        )}
        <div className="home-tools" aria-label="Creative tools">
          {creationTools.map((tool) => (
            <button
              key={tool.label}
              className={`home-tool home-tool-${tool.color}`}
              disabled={create.isPending}
              onClick={() => {
                if (!create.isPending) create.mutate(tool.type);
              }}
              aria-label={`Create ${tool.label.toLowerCase()}`}
            >
              <span className={`home-tool-art tool-color-${tool.color}`}>
                <span>
                  <Icon name={tool.icon} size={46} />
                </span>
              </span>
              <span className="home-tool-body">
                <span className="home-tool-title">
                  {tool.label}
                  <Icon name="plus" size={18} />
                </span>
                <span className="home-tool-description">
                  {tool.description}
                </span>
              </span>
            </button>
          ))}
        </div>
        <section className="home-guide" aria-labelledby="home-guide-title">
          <div>
            <span className="home-guide-eyebrow">FROM IDEA TO CREATION</span>
            <h2 id="home-guide-title">Start with something simple.</h2>
            <p>Three steps to your first result.</p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Choose a tool</h3>
                <p>Start with an image, a video or a voice.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Add your content</h3>
                <p>Describe your idea and add references if needed.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Run and refine</h3>
                <p>Generate a result, then keep shaping your idea.</p>
              </div>
            </li>
          </ol>
        </section>
      </div>
    </WorkspaceLayout>
  );
}
