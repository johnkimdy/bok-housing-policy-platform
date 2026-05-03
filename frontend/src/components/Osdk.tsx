import { AnchorButton, Icon, Tag } from "@blueprintjs/core";
import React from "react";
import css from "./Osdk.module.css";

const DOCUMENTATION_URL =
  "https://jkimdy.usw-17.palantirfoundry.com/workspace/developer-console/app/ri.third-party-applications.main.application.894012e0-e9ae-4559-ba37-82719ca713b1/docs/guide/loading-data?language=typescript";

function Osdk(): React.ReactElement {
  return (
    <div className={css.osdk}>
      <div>
        <span>OSDK: </span>
        <Tag minimal={true}>@bank-of-korea-housing-policy-dashboard/sdk</Tag>
      </div>
      <AnchorButton
        href={DOCUMENTATION_URL}
        target="_blank"
        rel="noreferrer"
        variant="minimal"
        icon={<Icon icon="book" aria-label="Book icon"></Icon>}
      >
        View documentation
      </AnchorButton>
    </div>
  );
}

export default Osdk;
