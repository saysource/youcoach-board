# Drupal Backend

This specs describe how we want to tackle the ability for a registered user in youcoach Drupal to use the editor.

## Requirements

The application is served by a specialized Drupal module, which controls that the user is logged in, and renders the full page designer (HTML + required modules) on the url:

https://somedomain/youcoach-board

The page renders the HTML wrapper for the designer, add all the required javascript imports and run a simple javascript script to initialize the designer based on passed Drupal settings.

All resources will be loaded from:

https://somedomain/youcoach-board/reource?id=RESOURCE_LOCATION

i.e.:

https://somedomain/youcoach-board/reource?id=images/optimized/fields/11/10_mini.png


https://somedomain/youcoach-board/reource?id=catalog.json


We will provide an API to render videos (out of scope for now).


## youcoach_board module

The module will be structured as follow:

youcoach_board/youcoach_board.info
youcoach_board/youcoach_board.module
youcoach_board/templates/youcoach_board.tpl.html
youcoach_board/js/youcoach_board.js (kickstarter)
youcoach_board/build/ (build and home of youcoach-board react app)
youcoach_board/resources/

The folder youcoach_board/resources will be protected via .htaccess and contain all the resources (images, catalog, etc...) which will be proxied by the /resource callback.

## task

1. validate that the app can work as planned by the module (i.e. be able to load files from the ./build/ path)

2. create a script to copy the app build to:
/Users/gtoffoli/Saysource/progetti/Youcoach/httpdocs/sites/all/modules/saysource/youcoach_board/build/

and all the resources to:

/Users/gtoffoli/Saysource/progetti/Youcoach/httpdocs/sites/all/modules/saysource/youcoach_board/resources/

Both build and resources folders will be added to .gitignore

3. create a prompt for the creation of the youcoach_board module in my Drupal environment (who know everything about Drupal and how to write modules there)



## Video export

The video export is provided by a specific service exposed to the client by Drupal.
The actual export involves 4 actors:

- the client that initiate the export request by invoking Drupal
- Drupal which works as orchestrator, by storing the request details
- YouCoach Video Analysis backend, invoked by Drupal with backend to backend request to let youcoach video analysis send a message to RabbitMQ
- The actual exporter job runner, that listen to RabbitMQ for jobs

### The client request

At initilization of the board, we provide to the client and URL to make export requests. Drupal will implement that endpoint:
/youcoach-board/export
which accept only POST request from authenticated users.
The client sends to this endpoint a JSON payload with the drawing to export:

{
  "format": "mp4",
  "size": { width: 1920, height: 1080},
  "data": "json encoded data as string..."
}

### Drupal Export Endpoint (/youcoach-board/export)

The endpoint verifies that the users is authenticated, and perfomes the following:
- generates a unique client token for this export job
- generates a uniqueand an export token for this export job
- stores the job details along the tokens into the table youcoach_board_jobs
- invokes the youcoach va service "send-board-export-request" by means of the function mycoach_va_call_api; we do something similar in youcoach_ai (@/Users/gtoffoli/Saysource/progetti/Youcoach/httpdocs/sites/all/modules/saysource/mycoach_ai/mycoach_ai.chat.inc) by invoking a very similar service called send-ai-request.
- sends back to the client the client_token to let the client polling the request status

Here is the definition of youcoach_board_jobs

youcoach_board_jobs (
  id,
  uid,
  create_on,
  export_format,
  export_size,
  token, // token for the client
  export_token, // token for the server
  status,
  result
)

### YouCoach Video Analysis "/youcoach-api/send-board-export-request" Endpoint

This endpoints is provided by the backend of YouCoach Video Analysis.
It is very similar to the service (/youcoach-api/send-ai-request), and needs to be implemented in @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/server/src/Controller/YouCoachApiController.php

The service sends a message to the queue youcoach_board_requests, that needs to be configured in @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/server/config/packages/messenger.yaml

The payload sent by Drupal with send-board-export-request will contain:
- export format and size of the export;
- an url that allows to open youcoach-board app with the related JSON preloaded and in presentation mode, something like:
https://www.youcoach.it/youcoach-board/render/%export_token

This URL will be open as anonymous, this means that in order to load the resources for youcoach-board (which are currently requiring a logged_id_user), the page will provide a special drupal signed token to the resources URL. An option is to generate a temporary resource access token with drupal_get_token and verify it with drupal_valid_token. The access token can be appended to the resource url template to obtain an url like https://somedomain/youcoach-board/reource?id=catalog.json&token=access_token
The resource endpoint must be adapter to use the tokeb in leau of a valid user when gating access to the board resources.


### The MQ message consumer and exporter

The consumer of messages sent to the queue youcoach_board_requests is a nodejs script similar to the the ones we implemented for youcoach video analysis here: 
- queue listener: @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/lambda-renderer/rendererSingleProcess.mjs
- exporter: /Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/lambda-renderer/renderFunction.mjs

We probably don't need two files, just one is ok. The script:
1. listen for export requests from the youcoach_board_requests
2. as soon a request arrives, it loads the URL provided in the message by using puppeteer: this Drupal invokation will set the status of the job to "processing".
3. puppeteer must open the URL by setting the window viewport of a size congruent with the export requested:
 - 1440 x 1080 for 1440 x 1080 export
 - 1920 x 1080 for 1920 x 1080 export
 - 2560 x 1920 for 1080 x 1920 export (the screenshot need to crop the center of the image)
4. use the window.events API to "pilot" the youcoach-board viewer in order to:
 - ask for the number of total animation frames
 - take a screenshot of the frames, one by one, by asking to move to the next frame starting from 0
 - stream the screenshots to ffmpeg
5. as the video is complete, sends the video to Drupal with another dedicated and token based Drupal endpoint (https://www.youcoach.it/youcoach-board/render/%export_token/complete), the video is stored in drupal_private/board-exports directory and the job status becomes completed.
6. in case of error, the script invokes a status endpoint to set the job status to error (https://www.youcoach.it/youcoach-board/render/%export_token/error)


### Job completion

The client, who is polling Drupal with a specialized service, i.e. https://www.youcoach.it/youcoach-board/export/%client_token/status, as the status becomes completed, will fetch the stored file with /youcoach-board/export/%client_token/download
As the dowload from the client is completed, the mp4 file is deleted


### Resources cleanup

A cron inside youcoach_board should take care of removing jobs older than 1 hour and related mp4.

