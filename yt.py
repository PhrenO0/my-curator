#!/usr/bin/env python3
"""youtube_brain 단축 진입점.  사용: python yt.py "<링크|키워드>" [...]  (= python -m youtube_brain ...)"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from youtube_brain.__main__ import main  # noqa: E402

if __name__ == "__main__":
    main()
